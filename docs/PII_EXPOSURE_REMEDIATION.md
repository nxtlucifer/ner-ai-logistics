# PII exposure remediation

**Opened** 26 September 2026. **Owner** CISO + Data Governance.
**Scope** personal data visible in files the public repository publishes, or
would publish once `post-demo-integration` is pushed.

Every phone number below is masked to its last two digits. No number, password
or key is written in this document.

---

## 1. Result

```text
PII_PUBLIC_FILES_BEFORE      12 screenshots on origin/main show the demo
                             driver's full phone number (inside the licence
                             line under "Demo Driver")
PII_PUBLIC_FILES_AFTER       0 of those 12 on this branch - replaced by
                             redacted copies
NEW_EXPOSURE_PREVENTED       6 more images and 4 generated documents that the
                             integration commits would have published for the
                             first time, redacted before they were committed
HISTORY_PII_REMAINS          YES - see section 4
CURRENT_BRANCH_PII_EXPOSURE  text only, all already public on origin - see
                             section 3
```

## 2. What was changed

### The 12 public screenshots (already on origin/main)

`docs/terrain-command/evidence/{after,before,iteration1}-driver-{assistant,home,safety,translator}.png`

The line under "Demo Driver" (the licence identifier, which embeds the demo
driver's 10-digit phone number ********60) is painted over with the local
background colour and labelled "licence redacted". The driver name, the screen
and the evidence value are unchanged. The redacted files were produced by a
canvas script and each was inspected by eye.

### Images the integration branch would have published for the first time

These were corrected inside the commit that first adds them, so the unredacted
versions never enter this branch's history.

| commit | file | what was there | now |
|---|---|---|---|
| 19 | `docs/submission/day1/task3/screenshots/09-drivers-desktop.png` | five driver phone numbers under the names | "phone redacted" |
| 19 | `docs/submission/day1/task3/screenshots/10-drivers-validation-422.png` | the same five numbers | "phone redacted" |
| 19 | `docs/submission/day1/task3/screenshots/32-driver-a.png` | the demo number as a login placeholder, and the demo driver's login number typed into the field | fields shown empty |
| 19 | `docs/submission/day1/task3/RASTA_AI_Task_Report.docx` / `.pdf` | embedded the three figures above | rebuilt with `build_report.py` from the redacted figures |
| 20 | `docs/submission/day2/task1/screenshots/07b_manager_drivers_list.png` | byte-identical to figure 09 | the redacted figure 09 |
| 21 | `docs/submission/day2/task2/evidence/03_xss_test.png` | four probe-driver phone numbers | "phone redacted"; the XSS evidence (payload rendered as text) is intact |
| 21 | `docs/submission/day2/task2/RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL.docx` / `.pdf` | embedded that screenshot (the PDF as a downscaled JPEG on page 8) | rebuilt with `build_report.py`; page 8's embedded image re-extracted and inspected |

Verification: every rebuilt `.docx` contains the redacted image byte-for-byte
and not the original; the text layers of every rebuilt `.docx` and `.pdf` hold
no phone-shaped number.

### Two untracked screenshots

`day1/.../09-drivers-desktop.png` and `day2/.../07b_manager_drivers_list.png`
were never pushed. They are published on this branch only in redacted form,
because the reports cite them.

## 3. What is still visible on this branch (text, all already public)

Found by a repository-wide text sweep (2 scopes, 5 pattern families) and
confirmed by an independent reviewer. None of these is new; each is on
origin/main today. They are listed for a decision, not changed silently,
because some are functional.

| where | what | why it was not changed here |
|---|---|---|
| `backend/scripts/demo_account.py`, handoff documents, some tests | the demo and QA login phone numbers (********60, ********37, ********02) | `demo_account.py` creates the hosted demo account with that number; changing it changes the demo login |
| `docs/SUPABASE_MIGRATION_MISSION.md:789` | a personal Gmail address | a document edit the owner should confirm |
| `backend/app/services/places/data/corridor_snapshot.json` | one business WhatsApp number (********62) inside an OpenStreetMap `operator` value | public OSM data under ODbL; the snapshot is generated, so the fix belongs in the generator |
| `driver-app/eas.json` | the Supabase anon (publishable) key | public by design in a mobile build; not a secret |

Searches that found nothing: API keys, `service_role` values, secret keys,
credentialed DSNs to real hosts, private emails in new files, licence numbers
embedding a phone in text.

Found by the adversarial reviewers and left for the owner (none is a phone
number):

| where | what |
|---|---|
| final deck, commit 22 (`.pptx` slide 4 and `.pdf` page 4) | the demo driver's full licence number; a real person's face as the driver avatar |
| final deck `.pptx`, `docProps/core.xml` | a personal name in `lastModifiedBy` |
| Day 1 figures 32 and 33, Day 2 screenshots 08 and 08c | the demo driver's full licence number in the app header |
| Day 1 figure 03 (`03-login-error.png`) | the demo manager's login email (on the reserved `.example` domain) typed into the form |
| `docs/ENGINEERING_PROGRESS.md`, `CLAUDE_FINAL_QA.md`, `SIH26002_GAP_MATRIX.md`, `SUPABASE_MIGRATION_MISSION.md`, `TERRAIN_COMMAND_MISSION.md`, one test comment | local Windows paths that show the account username and machine name (already on origin) |

The deck is submission material and was not altered.

## 4. What remains in git history

Replacing a file removes it from the branch, **not from history**. The 12
original screenshots stay reachable in every commit on origin/main up to
`e4043ce`, and anyone who clones the repository can recover them.

Removing them from history needs a rewrite (for example `git filter-repo`) and a
force-push. That is irreversible for everyone who has cloned, and it was
**not authorised**. It remains the owner's decision.

The originals of the images redacted inside commits 19-21 were never in any
pushed commit; they exist only in the local preservation tags
`snapshot/post-demo-2026-09-26*`, which are not pushed.

## 5. Decisions for the owner

1. History rewrite for the 12 originals: yes or no.
2. Whether the demo login numbers and the personal Gmail in the text files may
   be masked (the demo account would need a new login number).
3. The deck: licence number, avatar photo, file metadata; and whether the
   demo licence number and the local Windows paths should be masked elsewhere.
4. Whether `acquire_places_snapshot.py` should drop contact digits from
   `operator` values.
