#!/bin/sh
# Working set by /proc sampling: every 0.2 s record each live process's open files and mapped files.
# Lean mmaps every .olean it imports, so the maps catch the toolchain's real footprint.
cd /work/app
rm -rf .prism .lexlean
out=/work/.probe-ws-$1.txt; : > "$out"
( while :; do for p in /proc/[0-9]*; do cat "$p/maps" 2>/dev/null | awk '$6 ~ /^\// {print $6}'; for f in "$p"/fd/*; do readlink "$f" 2>/dev/null; done; done | grep -v '^/proc\|^/dev\|^/work\|^/tmp\|^/sys\|(deleted)' | sort -u >> "$out"; sleep 0.2; done ) &
sampler=$!
s=$(date +%s)
case "$1" in
  t1) lexlean verify --project /work/app/lexlean.toml >/dev/null 2>&1 ;;
  t0) prismpm --project . check >/dev/null 2>&1 ;;
  t2) prismpm --project . verify >/dev/null 2>&1 ;;
esac
code=$?
kill $sampler 2>/dev/null; wait $sampler 2>/dev/null
echo "$1 exit $code in $(( $(date +%s) - s )) s"
sort -u "$out" > "$out.uniq"
echo "== $1 working set by top directory (MB, files)"
while IFS= read -r f; do [ -f "$f" ] && printf '%s %s\n' "$(stat -c %s "$f")" "$f"; done < "$out.uniq" \
  | awk '{ split($2, p, "/"); key="/"p[2]"/"p[3]; s[key]+=$1; n[key]++; tot+=$1; cnt++ } END { for (k in s) printf "%8.1f %6d %s\n", s[k]/1e6, n[k], k; printf "%8.1f %6d TOTAL\n", tot/1e6, cnt }' | sort -rn | head -30
