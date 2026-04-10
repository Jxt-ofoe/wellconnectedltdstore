const categories = [];

exports.getCategories = (req, res) => {
  res.json(categories);
};

exports.createCategory = (req, res) => {
  const { name, image } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const newCategory = { id: Date.now(), name, image: image || null };
  categories.push(newCategory);
  res.status(201).json(newCategory);
};
