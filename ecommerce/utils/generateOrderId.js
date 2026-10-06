export const generateOrderId = () => {
  const timestamp = Date.now();

  const uniqueNumber = timestamp
    .toString()
    .slice(-6);

  return `NL-${uniqueNumber}`;
};
