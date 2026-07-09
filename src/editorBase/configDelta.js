// Pure helper for the "Review changes" modal: compute the minimal partial
// config (a deepmerge overlay with array-overwrite semantics) that transforms
// `past` into `current`.
//
// Object-key deletions cannot be expressed in a merge overlay (arrays are
// replaced wholesale, so array-level additions/removals/edits CAN) - such
// paths are returned in `deletions` for the caller to surface to the user.
// Invariant: when `deletions` is empty,
//   deepmerge(past, partial, { arrayMerge: (d, s) => s })
// deep-equals `current`.

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// deep copy via JSON (config content is always JSON-safe)
const clone = (value) => JSON.parse(JSON.stringify(value))

export const computeConfigDelta = (past, current) => {
  const deletions = []

  if (!isPlainObject(past) || !isPlainObject(current)) {
    return {
      partial: isPlainObject(current) ? clone(current) : {},
      deletions
    }
  }

  const walk = (pastNode, currentNode, path) => {
    const partialNode = {}

    Object.keys(currentNode).forEach((key) => {
      const childPath = path ? path + '.' + key : key
      const pastValue = pastNode[key]
      const currentValue = currentNode[key]

      if (!(key in pastNode)) {
        // addition
        partialNode[key] = clone(currentValue)
      } else if (isPlainObject(pastValue) && isPlainObject(currentValue)) {
        const childPartial = walk(pastValue, currentValue, childPath)
        if (Object.keys(childPartial).length) {
          partialNode[key] = childPartial
        }
      } else if (!jsonEqual(pastValue, currentValue)) {
        if (Array.isArray(pastValue) && isPlainObject(currentValue)) {
          // a plain-object overlay merged onto an array target produces a
          // mixed object - not expressible as a merge overlay
          deletions.push(childPath)
        } else {
          // changed primitive, changed/resized array (emitted wholesale)
          // or any other type change - all safely overwrite on merge
          partialNode[key] = clone(currentValue)
        }
      }
    })

    Object.keys(pastNode).forEach((key) => {
      if (!(key in currentNode)) {
        deletions.push(path ? path + '.' + key : key)
      }
    })

    return partialNode
  }

  return { partial: walk(past, current, ''), deletions }
}
