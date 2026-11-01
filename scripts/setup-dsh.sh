#!/usr/bin/env sh
# Prepare a clone for development: install the pinned DSH into .tools/dsh and write .tools/dsh-env.sh.
# Run from the repo root before typecheck, test and dev-profile.sh:   sh scripts/setup-dsh.sh
#
# Typecheck and tests read DSH's types and runtime packages from .tools/dsh/node_modules/@deepseek-ai
# (tsconfig.base.json, vitest.config.ts), so DSH is installed there with npm's flat layout.
# DSH pins its own packages but takes cordis and schemastery by range; the releases of 2026-10-16 no longer
# typecheck with our code, so npm resolves everything as of `before`, the week DSH 0.2.0-rc.2 came out.
# Nothing already in place is replaced: DSH is installed only when the pinned version is missing (delete
# .tools/dsh to reinstall), and an existing .tools/dsh-env.sh is kept, since it may carry this machine's settings.
set -eu
version=0.2.0-rc.2
before=2026-10-01
[ -f pnpm-workspace.yaml ] && [ -d packages ] || { echo "setup-dsh.sh: run from the repo root" >&2; exit 1; }

installed=$(node -p "require('./.tools/dsh/node_modules/@deepseek-ai/dsh/package.json').version" 2>/dev/null || true)
if [ "$installed" = "$version" ]; then
  echo "DSH $version already in .tools/dsh"
else
  mkdir -p .tools/dsh
  npm install --prefix .tools/dsh --save-exact --before="$before" --no-fund --no-audit "@deepseek-ai/dsh@$version"
fi

if [ -f .tools/dsh-env.sh ]; then
  echo ".tools/dsh-env.sh exists, left as it is"
else
  cat > .tools/dsh-env.sh <<'EOF'
# Development environment for DSH. Source it from the repo root:   . .tools/dsh-env.sh
# Written once by scripts/setup-dsh.sh, which never overwrites it.
root=$(pwd)
# Node on Windows takes D:/... paths; Git Bash's pwd gives /d/..., so ask for the Windows form when there is one.
native=$(pwd -W 2>/dev/null || pwd)
export PATH="$root/.tools/dsh/node_modules/.bin:$PATH"
export DSH_HOME="$native/.dsh-home"
export LEARNING_HOME="$native/.data"
# DSH refuses DEEPSEEK_BASE_URL from a .env file, so .env is exported into the environment instead.
if [ -f "$root/.env" ]; then set -a; . "$root/.env"; set +a; fi
EOF
  echo "wrote .tools/dsh-env.sh"
fi
