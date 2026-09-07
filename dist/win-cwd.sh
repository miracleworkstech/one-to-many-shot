# Sourced by the session packagers. Claude Code and Codex on Windows record the
# working directory as C:\Users\..., while `git rev-parse --show-toplevel` under
# Git Bash gives /c/Users/..., so the stock cwd match never fires. This derives,
# from SEARCH_ROOT, the project dir name Claude uses (C--Users-...) and the path
# as it appears in the session JSON (C:\\Users\\..., backslashes doubled).
case "$SEARCH_ROOT" in
    /[a-zA-Z]/*)
        _drive="$(printf %s "${SEARCH_ROOT:1:1}" | tr a-z A-Z)"
        WIN_ROOT="${_drive}:${SEARCH_ROOT:2}"
        ;;
    *) WIN_ROOT="$SEARCH_ROOT" ;;
esac
WIN_SANITIZED="$(printf %s "$WIN_ROOT" | sed 's|[:/_ ]|-|g')"
WIN_JSON="$(printf %s "$WIN_ROOT" | sed 's|/|\\\\|g')"
