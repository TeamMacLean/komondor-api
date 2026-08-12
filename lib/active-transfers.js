const activeTransfers = new Set();

const addTransfer = (id, filename) => {
  activeTransfers.add(JSON.stringify({ id, filename }));
};

const removeTransfer = (id, filename) => {
  activeTransfers.delete(JSON.stringify({ id, filename }));
};

const getActiveTransfers = () => {
  return Array.from(activeTransfers).map(str => JSON.parse(str));
};

module.exports = {
  addTransfer,
  removeTransfer,
  getActiveTransfers
};
