export function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function putMany<T>(
  openDatabase: () => Promise<IDBDatabase>,
  storeName: string,
  values: T[],
): Promise<void> {
  if (!values.length) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    values.forEach((value) => store.put(value));
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}
