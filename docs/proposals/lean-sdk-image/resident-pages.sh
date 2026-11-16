#!/bin/sh
# Per-process truth: sample /proc/<pid>/smaps and keep, per file, the most resident pages any process ever had.
# Shared-kernel page cache noise from other containers cannot leak in here.
cd /work/app; rm -rf .prism .lexlean
out=/tmp/smaps.txt; : > "$out"
( while :; do for p in /proc/[0-9]*; do awk -v pid="${p#/proc/}" '
  /^[0-9a-f]+-[0-9a-f]+ / { path = ($6 ~ /^\//) ? $6 : ""; next }
  /^Rss:/ && path != "" { rss[path] += $2 }
  END { for (f in rss) if (rss[f] > 0) print pid, rss[f], f }' "$p/smaps" 2>/dev/null; done >> "$out"; sleep 0.3; done ) &
sampler=$!
s=$(date +%s); lexlean verify --project /work/app/lexlean.toml >/dev/null 2>&1; code=$?
kill $sampler; wait $sampler 2>/dev/null
echo "t1 exit $code in $(( $(date +%s)-s )) s, $(wc -l < $out) samples"
# per file: max over (pid, sample) of resident kB
awk '{ if ($2 > m[$3]) m[$3] = $2 } END { for (f in m) print m[f], f }' "$out" | grep -v '^[0-9]* /work' | sort -rn > /tmp/max.txt
echo "== T1 resident by top-3 dir (MB, files)"
awk '{ split($2,p,"/"); key="/"p[2]"/"p[3]"/"p[4]; s[key]+=$1; c[key]++; t+=$1; tc++ } END { for (k in s) printf "%9.1f %6d %s\n", s[k]/1024, c[k], k; printf "%9.1f %6d TOTAL\n", t/1024, tc }' /tmp/max.txt | sort -rn | head -12
echo "== T1 elan resident by extension (MB resident / MB on disk of touched files)"
grep elan/toolchains /tmp/max.txt | while read r f; do echo "$r $(stat -c %s "$f") $f"; done | awk '{ ext=$3; sub(/.*\./,"",ext); s[ext]+=$1/1024; d[ext]+=$2/1e6 } END { for (e in s) printf "%8.1f /%8.1f %s\n", s[e], d[e], e }' | sort -rn
echo "== biggest resident files (MB resident / MB size)"
head -12 /tmp/max.txt | while read r f; do printf "%8.1f /%8.1f %s\n" "$(echo $r | awk '{print $1/1024}')" "$(stat -c %s "$f" | awk '{print $1/1e6}')" "$f"; done
echo "== which lean modules are touched: top-level namespaces (files)"
grep -o 'lib/lean/[A-Za-z]*' /tmp/max.txt | sort | uniq -c | sort -rn | head
echo "== how many distinct .olean modules touched vs total"; grep -c '\.olean$' /tmp/max.txt; find /usr/local/elan/toolchains -name '*.olean' | wc -l
echo "== processes seen"; awk '{print $1}' "$out" | sort -u | wc -l
cp /tmp/max.txt /work/.smaps-max.txt
echo DONE
