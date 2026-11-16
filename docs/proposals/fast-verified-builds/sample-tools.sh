#!/bin/sh
# Sample the command name of every live process once a second: the kernel's own 15-char comm, no guessing.
cd /work/app
rm -rf .prism .lexlean
( while :; do printf '%s ' "$(date +%s)"; ps -eo comm= | grep -vE '^(ps|sh|grep|sleep|date|printf|sort|uniq|tr)$' | sort | uniq -c | tr -s ' ' | tr '\n' ';'; echo; sleep 1; done ) > /work/.probe-samples2.txt 2>/dev/null &
sampler=$!
s=$(date +%s)
prismpm --project . verify > /work/.probe-verify2.log 2>&1
code=$?
e=$(date +%s)
kill $sampler 2>/dev/null
echo "exit $code wall $((e - s)) s"
