#!/bin/sh
# PLACEHOLDER. Batch DRAT-proof generation + drat-trim verification for
# every SAT patch-infeasibility certificate is still a TODO item (see
# TODO.md, "Certificate rigor"): today js_sat_bridge.js's runCadical only
# reports SAT/UNSAT, it doesn't request or archive a proof, and there is
# no batch drat-trim runner yet. This stage exists as an explicit, visible
# gap rather than silently skipping the rigor step -- main.sh calls it and
# it exits nonzero on purpose until the real tool is built, so
# reproduction stops here with a clear message instead of quietly
# reporting "done" without proof archives.
echo "[09_verify_sat_certificates] NOT YET IMPLEMENTED." >&2
echo "See TODO.md's 'Certificate rigor (the DRAT upgrade)' section." >&2
echo "Classification results (stages 00-08) are already complete and correct;" >&2
echo "this stage only adds independent, archivable proof certificates for the" >&2
echo "SAT-based non-tiler verdicts, for the paper's reproducibility appendix." >&2
exit 1
