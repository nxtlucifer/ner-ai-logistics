"""Read-only APK checks; never signs, aligns, extracts, or installs the artifact.

Python standard library plus official Android build tools. The JSON report is
deliberately separate from device install/runtime certification. Native DT_NEEDED
resolution checks bundled libraries against Android's public NDK system names;
it does not prove every library can load or execute on a particular handset.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import zipfile


SYSTEM_LIBS = {
    "libaaudio.so", "libandroid.so", "libbinder_ndk.so", "libc.so", "libdl.so",
    "libEGL.so", "libGLESv1_CM.so", "libGLESv2.so", "libGLESv3.so",
    "libjnigraphics.so", "liblog.so", "libm.so", "libmediandk.so",
    "libnativewindow.so", "libOpenMAXAL.so", "libOpenSLES.so", "libvulkan.so",
    "libz.so", "libcamera2ndk.so",
}


def run(command: list[str]) -> dict:
    result = subprocess.run(command, capture_output=True, text=True, timeout=90)
    return {"command": command, "exit_code": result.returncode,
            "stdout": result.stdout.strip(), "stderr": result.stderr.strip()}


def elf_metadata(data: bytes) -> dict:
    if data[:4] != b"\x7fELF":
        raise ValueError("Native .so entry is not ELF")
    bits = {1: 32, 2: 64}[data[4]]
    endian = {1: "<", 2: ">"}[data[5]]
    machine = struct.unpack_from(endian + "H", data, 18)[0]
    if bits == 64:
        phoff = struct.unpack_from(endian + "Q", data, 32)[0]
        phentsize, phnum = struct.unpack_from(endian + "HH", data, 54)
    else:
        phoff = struct.unpack_from(endian + "I", data, 28)[0]
        phentsize, phnum = struct.unpack_from(endian + "HH", data, 42)
    headers = []
    for index in range(phnum):
        offset = phoff + index * phentsize
        values = struct.unpack_from(endian + ("IIQQQQQQ" if bits == 64 else "IIIIIIII"), data, offset)
        if bits == 64:
            kind, _, fileoff, vaddr, _, filesz, _, alignment = values
        else:
            kind, fileoff, vaddr, _, filesz, _, _, alignment = values
        headers.append({"type": kind, "offset": fileoff, "vaddr": vaddr,
                        "filesz": filesz, "alignment": alignment})
    loads = [header for header in headers if header["type"] == 1]
    needed_offsets, string_address = [], None
    for header in headers:
        if header["type"] != 2:
            continue
        width = 16 if bits == 64 else 8
        for offset in range(header["offset"], header["offset"] + header["filesz"], width):
            tag, value = struct.unpack_from(endian + ("qQ" if bits == 64 else "iI"), data, offset)
            if tag == 0:
                break
            if tag == 1:
                needed_offsets.append(value)
            if tag == 5:
                string_address = value
    needed = []
    if needed_offsets:
        strings = next((header["offset"] + string_address - header["vaddr"]
                        for header in loads if string_address is not None
                        and header["vaddr"] <= string_address < header["vaddr"] + header["filesz"]), None)
        if strings is None:
            raise ValueError("ELF dynamic string table could not be resolved")
        for offset in needed_offsets:
            start = strings + offset
            end = data.index(b"\0", start)
            needed.append(data[start:end].decode("ascii"))
    return {"bits": bits, "machine": machine, "needed": needed,
            "load_alignments": [header["alignment"] for header in loads],
            "elf_16kb_load_alignment": bool(loads) and all(
                header["alignment"] >= 16384 and
                (header["vaddr"] - header["offset"]) % 16384 == 0
                for header in loads)}


def match(pattern: str, text: str) -> str | None:
    result = re.search(pattern, text)
    return result.group(1) if result else None


def inspect(apk: Path, build_tools: Path) -> dict:
    before = hashlib.file_digest(apk.open("rb"), "sha256").hexdigest()
    report = {"timestamp_utc": datetime.now(timezone.utc).isoformat(),
              "path": str(apk), "size_bytes": apk.stat().st_size, "sha256": before}
    with apk.open("rb") as raw, zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        report["zip_crc"] = "PASS" if archive.testzip() is None else "FAIL"
        report["structure"] = {
            "manifest_present": "AndroidManifest.xml" in names,
            "dex_files": [name for name in names if re.fullmatch(r"classes\d*\.dex", name)],
            "aab_structure_present": "BundleConfig.pb" in names or "base/manifest/AndroidManifest.xml" in names,
            "bundled_javascript": [name for name in names if name.startswith("assets/") and name.endswith(".bundle")],
        }
        libraries = defaultdict(list)
        for info in archive.infolist():
            if not re.fullmatch(r"lib/[^/]+/[^/]+\.so", info.filename):
                continue
            _, abi, name = info.filename.split("/")
            raw.seek(info.header_offset + 26)
            name_size, extra_size = struct.unpack("<HH", raw.read(4))
            data_offset = info.header_offset + 30 + name_size + extra_size
            libraries[abi].append({"name": name, "compressed": info.compress_type != zipfile.ZIP_STORED,
                                   "data_offset": data_offset, "zip_16kb_aligned": data_offset % 16384 == 0,
                                   **elf_metadata(archive.read(info))})
        for abi, rows in libraries.items():
            available = {row["name"] for row in rows}
            for row in rows:
                row["unresolved_non_system_needed"] = sorted(set(row["needed"]) - available - SYSTEM_LIBS)
        report["native_libraries"] = dict(libraries)
        union = {row["name"] for rows in libraries.values() for row in rows}
        report["native_summary"] = {
            abi: {"count": len(rows), "missing_relative_to_other_abis": sorted(union - {row["name"] for row in rows}),
                  "all_elf_loads_16kb_aligned": all(row["elf_16kb_load_alignment"] for row in rows),
                  "all_uncompressed_entries_zip_16kb_aligned": all(row["compressed"] or row["zip_16kb_aligned"] for row in rows),
                  "unresolved_dependencies": sorted({name for row in rows for name in row["unresolved_non_system_needed"]})}
            for abi, rows in libraries.items()}
        # Only extract public LAN/loopback API endpoints; never dump bundle strings.
        bundle = b"".join(archive.read(name) for name in report["structure"]["bundled_javascript"])
        report["bundle"] = {"size_bytes": len(bundle), "hermes_bytecode": bundle[:8] == bytes.fromhex("c61fbc03c103191f"),
                            "api_endpoints_found": sorted({value.decode("ascii") for value in re.findall(
                                rb"http://(?:localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+):8000", bundle)})}
    badging = run([str(build_tools / "aapt2.exe"), "dump", "badging", str(apk)])
    manifest = run([str(build_tools / "aapt2.exe"), "dump", "xmltree", str(apk), "--file", "AndroidManifest.xml"])
    text = badging["stdout"]
    xml = manifest["stdout"]
    report["manifest"] = {
        "aapt2_exit_code": badging["exit_code"], "xmltree_exit_code": manifest["exit_code"],
        "application_id": match(r"package: name='([^']+)'", text),
        "version_code": match(r"versionCode='([^']+)'", text),
        "version_name": match(r"versionName='([^']+)'", text),
        "min_sdk": match(r"minSdkVersion:'([^']+)'", text),
        "target_sdk": match(r"targetSdkVersion:'([^']+)'", text),
        "compile_sdk": match(r"compileSdkVersion='([^']+)'", text),
        "launch_activity": match(r"launchable-activity: name='([^']+)'", text),
        "split_attribute_present": bool(re.search(r"A: (?:[^\n]*:)?split\b|isSplitRequired[^\n]*true", xml)),
        "debuggable_true": bool(re.search(r"debuggable[^\n]*true", xml)),
        "extract_native_libs_false": bool(re.search(r"extractNativeLibs[^\n]*false", xml)),
        "cleartext_enabled": bool(re.search(r"usesCleartextTraffic[^\n]*true", xml)),
        "development_client_manifest_marker": bool(re.search(r"devlauncher|devmenu|expo\.modules\.devclient", xml, re.I)),
        "google_maps_api_key_metadata_present": "com.google.android.geo.API_KEY" in xml,
    }
    signature = run(["java", "-jar", str(build_tools / "lib" / "apksigner.jar"), "verify", "--verbose", "--print-certs", str(apk)])
    report["signature"] = signature
    report["zipalign"] = run([str(build_tools / "zipalign.exe"), "-c", "-P", "16", "4", str(apk)])
    after = hashlib.file_digest(apk.open("rb"), "sha256").hexdigest()
    report["artifact_unchanged"] = before == after
    failures = []
    if report["zip_crc"] != "PASS": failures.append("zip_crc")
    if not report["structure"]["manifest_present"] or not report["structure"]["dex_files"]: failures.append("apk_structure")
    if report["structure"]["aab_structure_present"] or report["manifest"]["split_attribute_present"]: failures.append("not_standalone_apk")
    if not report["structure"]["bundled_javascript"] or report["manifest"]["development_client_manifest_marker"]: failures.append("standalone_bundle")
    for tool in ("signature", "zipalign"):
        if report[tool]["exit_code"]: failures.append(tool)
    if badging["exit_code"] or manifest["exit_code"]: failures.append("manifest_tools")
    for abi in ("arm64-v8a", "x86_64"):
        if abi in libraries and not report["native_summary"][abi]["all_elf_loads_16kb_aligned"]: failures.append(f"elf_16kb:{abi}")
    for abi, summary in report["native_summary"].items():
        if summary["unresolved_dependencies"]: failures.append(f"native_dependencies:{abi}")
    if not report["artifact_unchanged"]: failures.append("artifact_changed")
    report["static_apk_checks"] = "FAIL" if failures else "PASS"
    report["static_failures"] = failures
    report["device_gates"] = {key: "NOT RUN" for key in (
        "adb_install", "normal_installer", "physical_device_launch", "release_without_metro", "core_workflow")}
    report["limitations"] = ["Static checks do not establish installability or runtime behavior.",
                              "WhatsApp-sent and phone-received byte identity remains unverified.",
                              "Public Android system dependency names do not establish device symbol compatibility."]
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--build-tools", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report = inspect(args.apk.resolve(strict=True), args.build_tools.resolve(strict=True))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("path", "size_bytes", "sha256", "manifest", "native_summary", "bundle", "static_apk_checks", "static_failures")}, indent=2))
    return 0 if report["static_apk_checks"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
