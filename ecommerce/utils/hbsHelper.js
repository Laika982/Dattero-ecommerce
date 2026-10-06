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

  hbs.registerHelper("includes", function (array, value) {
  if (!Array.isArray(array)) {
    return false;
  }

  return array.map(String).includes(String(value));
});

  hbs.registerHelper("json", function (context) {
    return JSON.stringify(context);
  });
};

hbs.registerHelper("formatDate", (date) => {
  if (!date) return "";

  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
});

hbs.registerHelper("formatStatus", (status) => {
  if (!status) return "";

  return status
    .split("_")
    .map((word) => {
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
});

export default registerHbsHelpers;