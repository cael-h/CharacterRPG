#!/usr/bin/env bash
set -euo pipefail

# Delete characters by name (case-insensitive) and remove their server bundles.
# Usage:
#   NAME=Olive CONFIRM=1 npm run purge:by-name
# Optional env:
#   BASE=http://localhost:4000   # server base URL
#   MODE=exact|contains          # match mode (default: exact)
#   MATCH_SLUGS=1                # also match slug forms of names (default: 1)

BASE="${BASE:-http://localhost:4000}"
NAME="${NAME:-}"
MODE="${MODE:-exact}"
CONFIRM="${CONFIRM:-}"
MATCH_SLUGS="${MATCH_SLUGS:-1}"

if [ -z "$NAME" ] || [ -z "$CONFIRM" ]; then
  echo "Usage: NAME=<name> CONFIRM=1 npm run purge:by-name" >&2
  echo "Optional: MODE=contains to match substrings (case-insensitive)." >&2
  exit 1
fi

echo "Fetching characters from $BASE ..." >&2
ROWS=$(curl -sf "$BASE/api/characters" || echo '[]')
# Fallback if the endpoint returned an empty body but a 2xx status
if [ -z "$ROWS" ]; then ROWS='[]'; fi
export ROWS

python3 - "$NAME" "$MODE" "$MATCH_SLUGS" << 'PY'
import sys,json,re,subprocess,os,shutil
name=sys.argv[1]
mode=sys.argv[2]
match_slugs = (sys.argv[3] == '1')
try:
  data=json.loads(os.environ.get('ROWS','[]') or '[]')
except Exception:
  data=[]

slug_re = re.compile(r'[^a-z0-9]+')
def slugify(s:str)->str:
  s = s.lower()
  s = slug_re.sub('-', s)
  return s.strip('-')

name_slug = slugify(name)

def match(n):
  if not isinstance(n,str): return False
  a=n.lower(); b=name.lower()
  if mode=='exact':
    if a==b: return True
    return match_slugs and slugify(a)==name_slug
  else:
    if b in a: return True
    return match_slugs and (name_slug in slugify(a))

targets=[r for r in data if match(r.get('name',''))]
print(f"Found {len(targets)} character(s) matching: {name} (mode={mode})", file=sys.stderr)

# Determine bundles dir from server/config.json
cfg_path=os.path.join('server','config.json')
profiles_dir='profiles'
try:
  with open(cfg_path,'r',encoding='utf-8') as f:
    cfg=json.load(f)
    profiles_dir=cfg.get('dirs',{}).get('profiles',profiles_dir)
except Exception:
  pass

for r in targets:
  cid=r.get('id'); nm=r.get('name');
  if not cid: continue
  print(f"Deleting {nm} ({cid}) ...", file=sys.stderr)
  subprocess.run(["curl","-sfX","DELETE",f"{os.environ.get('BASE','http://localhost:4000')}/api/characters/{cid}"], check=False)
  # Remove bundle directory patterns *__<id>, legacy id folders, name or slug folders
  try:
    if os.path.isdir(profiles_dir):
      for d in os.listdir(profiles_dir):
        p=os.path.join(profiles_dir,d)
        if not os.path.isdir(p):
          continue
        dlow = d.lower()
        hit = False
        if dlow.endswith("__"+str(cid).lower()) or d == str(cid) or (str(cid).lower() in dlow):
          hit = True
        else:
          try:
            nm_slug = slugify(nm or '')
          except Exception:
            nm_slug = ''
          if nm and ((dlow.startswith((nm or '').lower()+"__")) or (dlow==(nm or '').lower())):
            hit = True
          elif nm_slug and (dlow.startswith(nm_slug+"__") or dlow==nm_slug or nm_slug in dlow):
            hit = True
          if not hit:
            # Content check: profile.md mentions the name
            prof = os.path.join(p,'profile.md')
            try:
              with open(prof,'r',encoding='utf-8', errors='ignore') as fh:
                txt = fh.read(4096).lower()
                if (nm or '').lower() and (nm or '').lower() in txt:
                  hit = True
            except Exception:
              pass
        if hit:
          print(f"Removing bundle {p}", file=sys.stderr)
          shutil.rmtree(p, ignore_errors=True)
  except Exception as e:
    print(f"Warn: could not scan/remove bundles in {profiles_dir}: {e}", file=sys.stderr)
PY

echo "Done." >&2
