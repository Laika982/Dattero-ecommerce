export function generatePageArray(totalPages) {
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    pages.push(i);
  }
  return pages;
}

export function generateActivePageArray(totalPages, currentPage) {
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    pages.push({
      page: i,
      active: i === currentPage,
    });
  }
  return pages;
}
