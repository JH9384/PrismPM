# Sourced by an obligation whose checks read the bootstrap release's history:
# the source commit and tag object tools.lock pins for v0.2.0. A closure is one
# commit, so it fetches that history by name and holds the tag to the pinned
# object (tools.lock is an input of the identity); a full checkout already has
# it and fetches nothing.
prism_bootstrap_history() {
  local tag
  tag=$(sed -n '/^\[bootstrap-sdk\]/,/^\[/s/^tag_object = "\([0-9a-f]\{40\}\)"$/\1/p' tools.lock)
  [ -n "$tag" ] || { echo "$FACTORY_OBLIGATION: tools.lock pins no bootstrap tag object" >&2; return 65; }
  if [ "$(git cat-file -t "$tag" 2>/dev/null)" != tag ]; then
    git fetch --quiet --no-tags https://github.com/UOR-Foundation/PrismPM refs/tags/v0.2.0:refs/tags/v0.2.0
    [ "$(git rev-parse refs/tags/v0.2.0)" = "$tag" ] || { echo "$FACTORY_OBLIGATION: v0.2.0 is not the pinned tag object $tag" >&2; return 65; }
  fi
}
