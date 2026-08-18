export function createDataRefreshGate(getCurrentMapId) {
  let generation = 0;
  return {
    invalidate() { generation += 1; },
    begin(mapId) {
      const requestGeneration = ++generation;
      return () => requestGeneration === generation && getCurrentMapId() === mapId;
    }
  };
}
