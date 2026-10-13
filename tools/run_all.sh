#!/bin/bash
cd /home/user/work/michael-ai-v8
set -a; . /home/user/tab/files/.michael-sched.env; set +a
export BLOB_READ_WRITE_TOKEN=$(grep '^BLOB_READ_WRITE_TOKEN=' /home/user/tab/files/.michael-wa-secrets.env | cut -d= -f2-)
export GEMINI_API_KEY=test-key
for t in t_v2 t_v3 t_v4 t_v5 t_v51 t_v6 t_v7 t_v71 t_v72 t_v8 t_v9 t_v91 t_v92 t_v93 t_v94 t_v95 t_v96; do
  # t_v71 checks 'skip the NEXT letter' against the real clock; letter 1 went out 12 Oct 2026 07:00Z, so it runs on a fixed clock (v9.5)
  if [ $t = t_v71 ]; then out=$(FAKE_NOW=2026-10-11T12:00:00Z timeout 400 node --import ./tools/fake-clock.mjs $t.mjs 2>&1); rc=$?
  else out=$(timeout 400 node $t.mjs 2>&1); rc=$?; fi
  echo "== $t rc=$rc :: $(echo "$out" | grep -E 'checks passed|passed|AssertionError' | tail -2 | tr '\n' ' ')"
  [ $rc -ne 0 ] && echo "$out" | grep -v '^\[' | tail -15
done
echo DONE
