function generateSlug(name) {
  return name.toLowerCase().split(" ").join("-");
}

module.exports = generateSlug;
