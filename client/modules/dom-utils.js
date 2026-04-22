const elementCache = new Map();

export function getElement(id) {
  if (!elementCache.has(id)) {
    const element = document.getElementById(id);
    elementCache.set(id, element || null);
  }

  return elementCache.get(id);
}

export function clearElementCache(id) {
  if (id) {
    elementCache.delete(id);
    return;
  }

  elementCache.clear();
}