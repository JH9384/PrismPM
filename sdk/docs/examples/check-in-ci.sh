prism-code check Calculator.holo # exit 1
prism-code check Calculator.holo --policy pure-only
prism-code check Calculator.holo --policy provenance-only --json # exit 1
