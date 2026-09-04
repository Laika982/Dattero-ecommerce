import hbs from "hbs";

const registerHbsHelpers = () => {
  hbs.registerHelper("gt", (a, b) => {
    return a > b;
  });

  hbs.registerHelper("lt", (a, b) => {
    return a < b;
  });

  hbs.registerHelper("add", (a, b) => {
    return a + b;
  });

  hbs.registerHelper("subtract", (a, b) => {
    return a - b;
  });

  hbs.registerHelper("eq", (a, b) => {
    return String(a) === String(b);
  });

  hbs.registerHelper("multiply", (a, b) => {
    return Number(a) * Number(b);
  });

  hbs.registerHelper("range", (start, end) => {
    const result = [];

    for (let i = start; i <= end; i++) {
      result.push(i);
    }

    return result;
  });
};

export default registerHbsHelpers;