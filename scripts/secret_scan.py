"""Secret scan over everything a release commit would contain.

Run before any push:

    python scripts/secret_scan.py

Exit code is 0 when clean and 1 when anything is UNSAFE, so it works as a
pre-push gate rather than something a person has to remember to read.

Scans BOTH the untracked staging candidates and every modified tracked file,
because a secret introduced into an already-tracked file is exactly as bad and
is easier to miss.

Reports FILE / TYPE / VERDICT only. Never prints a matched value.
"""
import subprocess, re, os

ROOT = os.getcwd()

untracked = subprocess.run(['git', 'ls-files', '--others', '--exclude-standard'],
                           capture_output=True, text=True).stdout.split('\n')
modified = subprocess.run(['git', 'diff', '--name-only'],
                          capture_output=True, text=True).stdout.split('\n')
paths = sorted({p.strip().replace(chr(92), '/') for p in untracked + modified if p.strip()})

SKIP = re.compile(r'^(\.claude|\.artibot|\.agentic|\.agentops|\.coworker|\.context-os|\.remember|\.thumbgate|\.semgrep|\.codex|supabase/\.temp|memory/)|'
                  r'(package-lock\.json|\.png$|\.jpg$|\.jpeg$|\.ico$|\.svg$|\.woff2?$|\.apk$)')

# Patterns for material that must never reach a public repository.
RULES = [
    ('SUPABASE SERVICE ROLE (sb_secret)', re.compile(r'sb_secret_[A-Za-z0-9_-]{10,}')),
    ('SUPABASE SERVICE ROLE (legacy JWT)', re.compile(r'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*?c2VydmljZV9yb2xl')),
    ('GOOGLE API KEY', re.compile(r'AIza[0-9A-Za-z_-]{35}')),
    ('OPENROUTER KEY', re.compile(r'sk-or-v1-[0-9a-f]{16,}')),
    ('OPENAI-STYLE KEY', re.compile(r'sk-[A-Za-z0-9]{32,}')),
    ('POSTGRES URL WITH PASSWORD', re.compile(r'postgres(?:ql)?(?:\+\w+)?://[^\s:@/]+:[^\s:@/]{3,}@')),
    ('PRIVATE KEY BLOCK', re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),
    ('AWS ACCESS KEY', re.compile(r'AKIA[0-9A-Z]{16}')),
]

# Values that look like secrets but provably are not.
BENIGN = [
    (re.compile(r'sb_secret_\.\.\.|sb_secret_[^A-Za-z0-9]'), 'literal in a validation message / classifier'),
    (re.compile(r'postgres(?:ql)?(?:\+\w+)?://[^\s:@/]+:(?:pw|password|PASSWORD|\{pw\}|\$\{[^}]+\}|x|CHANGEME|placeholder)@'), 'placeholder credential'),
    # Angle-bracket documentation placeholders: <pw>, <user>, <password>.
    (re.compile(r'://[^\s@/]*<[^>]+>[^\s@/]*@|://[^\s:@/]+:<[^>]+>@'), 'documentation placeholder'),
]

findings = []
scanned = 0
for p in paths:
    if SKIP.search(p) or not os.path.isfile(p):
        continue
    try:
        text = open(p, encoding='utf-8', errors='ignore').read()
    except Exception:
        continue
    scanned += 1
    for name, rx in RULES:
        for m in rx.finditer(text):
            frag = m.group(0)
            why = None
            for brx, reason in BENIGN:
                if brx.search(frag):
                    why = reason
                    break
            line = text[:m.start()].count('\n') + 1
            findings.append((p, line, name, 'SAFE (' + why + ')' if why else 'UNSAFE'))

print('FILES SCANNED :', scanned)
print('MATCHES       :', len(findings))
print()
if findings:
    print('%-58s %-6s %-32s %s' % ('FILE', 'LINE', 'TYPE', 'VERDICT'))
    for p, line, name, verdict in findings:
        print('%-58s %-6d %-32s %s' % (p[:58], line, name, verdict))
else:
    print('No credential-shaped material found.')

unsafe = [f for f in findings if f[3] == 'UNSAFE']
print()
print('SECRET_SCAN =', 'FAIL' if unsafe else 'PASS', ' (unsafe: %d)' % len(unsafe))

import sys
sys.exit(1 if unsafe else 0)
