#!/bin/sh
cd /work/app; rm -rf .prism .lexlean
: > /tmp/w.txt; : > /tmp/cmd.txt
( while :; do for p in /proc/[0-9]*; do pid=${p#/proc/}; awk -v pid="$pid" '$6 ~ /lib\/lean\/Lean\// { n++ } $6 ~ /lib\/lean\/(Init|Std)\// { m++ } END { if (n+m > 0) print pid, n+0, m+0 }' "$p/maps" 2>/dev/null && { printf '%s ' "$pid"; tr '\0' ' ' < "$p/cmdline" 2>/dev/null | cut -c1-160; echo; } >> /tmp/cmd.txt; done >> /tmp/w.txt; done ) &
sampler=$!
lexlean verify --project /work/app/lexlean.toml >/dev/null 2>&1
kill $sampler; wait $sampler 2>/dev/null
echo "== pid maxLeanFiles maxInitStdFiles cmdline"
awk '{ if ($2>L[$1]) L[$1]=$2; if ($3>I[$1]) I[$1]=$3 } END { for (p in L) print p, L[p], I[p] }' /tmp/w.txt | sort -k2,2nr | while read pid l i; do c=$(grep -m1 "^$pid " /tmp/cmd.txt | cut -d' ' -f2-); echo "$pid Lean=$l InitStd=$i $c"; done | head -30
echo DONE
