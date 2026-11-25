#!/usr/bin/env bash
# A mage walks a person through steps only they can do, one stage at a time, checks each stage,
# and keeps a record of what finished so a rerun picks up where the last run stopped.
# Made by /odyssey:mage from the kit's template (built from Matt Pocock's `wizard`, MIT).
# Everything above the STAGES line is the same in every mage.
set -euo pipefail

MAGE_NAME=${MAGE_NAME:-example-setup}
MAGE_DIR=${MAGE_DIR:-.mage}
ENV_FILE=${ENV_FILE:-.env}
RECORD="$MAGE_DIR/$MAGE_NAME.record"
TOTAL=0
_N=0
_STEP=0
LEFT=()
TAB=$'\t'

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""
fi
mkdir -p "$MAGE_DIR"
touch "$RECORD"

say()  { printf '  %s\n' "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s! %s%s\n' "$YELLOW" "$1" "$RESET"; }
_record() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$3" >> "$RECORD"; }
_left() { LEFT+=("$2"); _record "$1" left "$2"; }

# do_this "action": a numbered step the person takes.
do_this() { _STEP=$((_STEP + 1)); printf '  %s%s.%s %s\n' "$BLUE" "$_STEP" "$RESET" "$1"; }

# run_this "machine" "command": a numbered command, alone on its line so it copies cleanly.
run_this() { _STEP=$((_STEP + 1)); printf '  %s%s.%s On %s, run:\n\n      %s\n\n' "$BLUE" "$_STEP" "$RESET" "$1" "$2"; }

# link URL: printed; also opened in a browser when this machine has a display and isn't an SSH session.
link() {
  printf '  %s->%s %s\n' "$GREEN" "$RESET" "$1"
  [[ -n "${SSH_CONNECTION:-}${SSH_TTY:-}" ]] && return 0
  if [[ "$(uname)" == Darwin ]]; then open "$1" >/dev/null 2>&1 || true
  elif command -v wslview >/dev/null 2>&1; then wslview "$1" >/dev/null 2>&1 || true
  elif [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true
  elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$1" >/dev/null 2>&1 || true
  fi
}

# _saved KEY: KEY's value in ENV_FILE, if it has one.
_saved() { [[ -f "$ENV_FILE" ]] || return 1; grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-; }

# ask KEY "prompt": a value the person may see. A rerun offers the saved value.
ask() {
  local current input
  current=$(_saved "$1" || true)
  printf '  %s%s%s ' "$BOLD" "$2" "$RESET"
  [[ -n "$current" ]] && printf '%s[Enter keeps %s]%s ' "$DIM" "$current" "$RESET"
  read -r input || true
  printf -v "$1" '%s' "${input:-$current}"
}

# ask_secret KEY "prompt": read without echo, never printed, never recorded. Enter keeps a saved one.
ask_secret() {
  local current input
  current=$(_saved "$1" || true)
  printf '  %s%s%s ' "$BOLD" "$2" "$RESET"
  [[ -n "$current" ]] && printf '%s[Enter keeps the saved one]%s ' "$DIM" "$RESET"
  read -rs input || true
  printf '\n'
  printf -v "$1" '%s' "${input:-$current}"
}

# save_env KEY: writes KEY=<its value> to ENV_FILE (readable by its owner only), replacing an
# older line. Prints the key, never the value.
save_env() {
  local tmp
  tmp=$(mktemp)
  touch "$ENV_FILE"
  grep -vE "^$1=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "${!1}" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  printf '  %sok%s %s saved to %s\n' "$GREEN" "$RESET" "$1" "$ENV_FILE"
}

# gh_secret NAME: sets the GitHub Actions secret NAME from its value, piped, never shown.
gh_secret() {
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 &&
    printf '%s' "${!1}" | gh secret set "$1" >/dev/null 2>&1; then
    printf '  %sok%s GitHub secret %s set\n' "$GREEN" "$RESET" "$1"
  else
    warn "GitHub secret $1 not set (gh is missing or signed out); later, run: gh secret set $1"
    _left "secret-$1" "GitHub secret $1"
  fi
}

# confirm "question": yes or no; anything but y is no.
confirm() {
  local reply=""
  printf '  %s? %s [y/N]%s ' "$YELLOW" "$1" "$RESET"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

# begin "title": the opening frame.
begin() {
  printf '\n%s%s%s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  note "$TOTAL stage(s). Stop any time with Ctrl-C; a rerun skips the stages already done."
}

# stage ID "title" STEPS CHECK: runs the STEPS function, then the CHECK function until it passes,
# and records the stage. A stage the record holds as done is skipped while its check passes. If
# the person gives up on a failing check, the run stops there, since later stages build on it.
stage() {
  local id="$1" title="$2" steps="$3" check="$4"
  _N=$((_N + 1))
  _STEP=0
  if grep -q "^$id${TAB}done${TAB}" "$RECORD" && "$check" >/dev/null 2>&1; then
    printf '\n%s%s%s/%s %s%s %s(already done)%s\n' "$BOLD" "$BLUE" "$_N" "$TOTAL" "$title" "$RESET" "$DIM" "$RESET"
    return 0
  fi
  if [[ -t 1 ]]; then tput clear 2>/dev/null || printf '\033[2J\033[H'; fi
  printf '\n%s%s%s/%s %s%s\n' "$BOLD" "$BLUE" "$_N" "$TOTAL" "$title" "$RESET"
  "$steps"
  until "$check"; do
    warn "The check for this stage didn't pass."
    if ! confirm "Try the check again?"; then
      _left "$id" "$title"
      finish
      exit 1
    fi
  done
  _record "$id" done "$title"
  printf '  %sok%s %s\n' "$GREEN" "$RESET" "$title"
}

# finish: the closing summary, from the record Claude reads after the run.
finish() {
  printf '\n%sRecord%s (%s):\n' "$BOLD" "$RESET" "$RECORD"
  cut -f1-3 "$RECORD" | sed 's/^/  /'
  if ((${#LEFT[@]})); then
    warn "Left to do by hand:"
    local item
    for item in "${LEFT[@]}"; do note "  - $item"; done
  fi
}

# ---- STAGES: this procedure's own. One stage per step, in order; TOTAL is how many. --------

TOTAL=1
begin "Example setup"

example_steps() {
  say "We'll copy the example service's ID and token into $ENV_FILE."
  link "https://example.com/settings/tokens"
  do_this "Open the page above and sign in."
  do_this "Copy the ID shown under API access."
  ask EXAMPLE_ID "Paste the ID:"
  do_this "Click Reveal token, then copy it."
  ask_secret EXAMPLE_TOKEN "Paste the token:"
  save_env EXAMPLE_ID
  save_env EXAMPLE_TOKEN
}
example_check() { [[ -n "$(_saved EXAMPLE_ID || true)" && -n "$(_saved EXAMPLE_TOKEN || true)" ]]; }
stage keys "Example: an ID and a token" example_steps example_check

finish
