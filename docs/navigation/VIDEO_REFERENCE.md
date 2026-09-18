# Navigation video reference

Status: **BLOCKED — the reference recording was never delivered to this machine.**

## What was asked for

A Google Maps journey recording was to be inspected frame by frame, with its
audio, and every observable behaviour tabulated with its timestamp so the
in-app navigation could be compared against it.

## What actually arrived

Two files, both text:

| Path | Size | What it is |
| --- | --- | --- |
| `RASTA_AI_Claude_Video_Navigation_Master_Prompt.md` | 27,289 B | The mission brief |
| `manifest-2.csv` | 1,740 B | A **manifest** listing 28 video parts |

The manifest is an index, not the media. It names 28 parts
(`part_000.mp4` … `part_027.mp4`, packaged as `video_part_01.zip` …
`video_part_28.zip`) totalling 3,300.97 s of runtime (55 min 1 s) and 309,725,829 bytes of
video. **None of those 56 files is present.**

Verified, not assumed:

```
$ ls /root/.claude/uploads/0dbed2b8-.../
78a995e9-RASTA_AI_Claude_Video_Navigation_Master_Prompt.md
a8a15020-manifest-2.csv

$ find / -xdev \( -name 'video_part_*' -o -name 'part_0*.mp4' -o -name '*.mp4' \
        -o -name '*.mov' -o -name '*.mkv' -o -name '*.webm' \) \
        -not -path '*/node_modules/*'
(no output)
```

Decoding tooling is a smaller obstacle than the missing media, and is stated
accurately here rather than overstated: `ffmpeg` is not on `PATH`, but
Playwright ships one in this image that could be used directly.

```
$ which ffmpeg ffprobe
ffmpeg NOT on PATH

$ ls /opt/pw-browsers/ffmpeg-1011/
COPYING.LGPLv2.1  DEPENDENCIES_VALIDATED  INSTALLATION_COMPLETE  ffmpeg-linux
```

So decoding is solvable. **The absent media is the blocker**, and it is
absolute: there is nothing to decode.

## Consequence for this work

**No claim of visual or audible fidelity to the recording is made anywhere in
this repository.** The reference table the mission specifies — timestamp,
visible behaviour, audible behaviour, trigger evidence, implementation target,
confidence — cannot be filled in from evidence, and filling it in from
expectation would be fabrication. It is therefore left empty rather than
plausible:

| Video timestamp | Visible behavior | Audible behavior | Trigger evidence | Implementation target | Confidence |
| --- | --- | --- | --- | --- | --- |
| _(none — no frame was decoded)_ | | | | | |

### OBSERVED IN VIDEO

Nothing. No frame was decoded, no waveform was read, no road name was seen and
no spoken phrase was heard.

### REQUESTED BUT NOT OBSERVED

Everything implemented under this mission is a **requested requirement**, built
against the project's own data and the provider's own maneuver steps. Each is a
requirement met, never a visual match:

- moving position marker, camera follow and browse/recenter
- maneuver arrow, along-route turn distance, "then" secondary maneuver
- spoken advance / approach / immediate cues
- state-change announcements and arrival
- missed-turn detection and policy-checked reroute
- ETA, remaining distance and time, arrival clock

### UNRESOLVED

- Layout proportions, panel placement, route stroke weights and colours,
  marker orientation and camera framing as Google renders them.
- Google's own distance rounding, cue wording, pause lengths and sound cues.
- Whether the recording contained a reroute, a GPS loss or an arrival at all.
- Recording speed changes or gaps, which the mission warns must be checked
  before any timing is inferred.

## To unblock

Supply **either**:

1. the 28 `video_part_NN.zip` files (or the reassembled MP4) at a path readable
   from this container — the bundled `ffmpeg` above can then decode them; **or**
2. a set of representative frames as images plus a timestamped transcript of the
   audio.

With (1) the table above can be filled from decoded frames. With (2) it can be
filled at the confidence the sampling supports, and that sampling limit stated.

## Related

The geographic route in the recording is also unknown, and a screen recording
alone would not establish it (mission §3). Navigation here is exercised against
the project's own assigned corridors and the deterministic replay fixtures in
`driver-app/src/map/replay.fixtures.json`.
