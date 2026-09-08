export function fs15Manifest() {
  return {
    id: 'community.fs15.catalog',
    version: '1.0.0',
    name: 'FS15 Catalog',
    description: 'Dynamic catalogue adapter',
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tt']
  };
}
