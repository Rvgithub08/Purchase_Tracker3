const PENDING_KEY = "pt_pending_queue_v1";

export const addPending = (item) => {
  try {
    const q = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    q.push(item);
    localStorage.setItem(PENDING_KEY, JSON.stringify(q));
  } catch (e) {
    console.error("addPending", e);
  }
};

export const getPending = () => {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
  } catch (e) {
    console.error("getPending", e);
    return [];
  }
};

export const setPending = (arr) => {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(arr || []));
  } catch (e) {
    console.error("setPending", e);
  }
};

export const clearPending = () => {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch (e) {
    console.error("clearPending", e);
  }
};
