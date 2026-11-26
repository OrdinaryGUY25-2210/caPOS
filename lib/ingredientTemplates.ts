/**
 * Template bahan baku siap pakai untuk setup awal. Owner memilih jenis usaha,
 * bahan umum langsung terdaftar (tanpa harga), lalu tinggal mengisi harga beli
 * di halaman Bahan Baku & Harga Beli. Kode satuan mengikuti tabel `units`
 * (gram, ml, pcs).
 */
export interface IngredientTemplateItem {
  name: string;
  unit: "gram" | "ml" | "pcs";
  category: string;
}

export interface IngredientTemplatePack {
  id: string;
  label: string;
  description: string;
  items: IngredientTemplateItem[];
}

export const INGREDIENT_TEMPLATES: IngredientTemplatePack[] = [
  {
    id: "kopi",
    label: "Kedai Kopi",
    description: "Kopi, susu, sirup, dan kemasan dasar",
    items: [
      { name: "Biji Kopi Arabika", unit: "gram", category: "beverage" },
      { name: "Biji Kopi Robusta", unit: "gram", category: "beverage" },
      { name: "Susu Segar", unit: "ml", category: "beverage" },
      { name: "Susu Kental Manis", unit: "ml", category: "beverage" },
      { name: "Creamer", unit: "gram", category: "beverage" },
      { name: "Gula Pasir", unit: "gram", category: "food" },
      { name: "Gula Aren Cair", unit: "ml", category: "beverage" },
      { name: "Sirup Karamel", unit: "ml", category: "beverage" },
      { name: "Sirup Vanila", unit: "ml", category: "beverage" },
      { name: "Bubuk Coklat", unit: "gram", category: "beverage" },
      { name: "Bubuk Matcha", unit: "gram", category: "beverage" },
      { name: "Es Batu", unit: "gram", category: "beverage" },
      { name: "Air Mineral", unit: "ml", category: "beverage" },
      { name: "Cup Plastik", unit: "pcs", category: "packaging" },
      { name: "Tutup Cup", unit: "pcs", category: "packaging" },
      { name: "Sedotan", unit: "pcs", category: "packaging" },
    ],
  },
  {
    id: "minuman",
    label: "Minuman (Teh, Boba, Jus)",
    description: "Teh, topping, buah, dan kemasan",
    items: [
      { name: "Teh Hitam", unit: "gram", category: "beverage" },
      { name: "Teh Hijau", unit: "gram", category: "beverage" },
      { name: "Gula Pasir", unit: "gram", category: "food" },
      { name: "Sirup Gula", unit: "ml", category: "beverage" },
      { name: "Susu Segar", unit: "ml", category: "beverage" },
      { name: "Bubuk Taro", unit: "gram", category: "beverage" },
      { name: "Boba/Tapioka Pearl", unit: "gram", category: "food" },
      { name: "Jelly", unit: "gram", category: "food" },
      { name: "Lemon", unit: "pcs", category: "food" },
      { name: "Buah Segar (Campur)", unit: "gram", category: "food" },
      { name: "Es Batu", unit: "gram", category: "beverage" },
      { name: "Cup Plastik", unit: "pcs", category: "packaging" },
      { name: "Tutup Cup", unit: "pcs", category: "packaging" },
      { name: "Sedotan", unit: "pcs", category: "packaging" },
    ],
  },
  {
    id: "makanan",
    label: "Makanan Ringan & Kafe",
    description: "Tepung, telur, mentega, dan bahan dapur umum",
    items: [
      { name: "Tepung Terigu", unit: "gram", category: "food" },
      { name: "Telur Ayam", unit: "pcs", category: "food" },
      { name: "Mentega", unit: "gram", category: "food" },
      { name: "Minyak Goreng", unit: "ml", category: "food" },
      { name: "Gula Pasir", unit: "gram", category: "food" },
      { name: "Garam", unit: "gram", category: "food" },
      { name: "Keju Cheddar", unit: "gram", category: "food" },
      { name: "Kentang", unit: "gram", category: "food" },
      { name: "Roti Burger/Bun", unit: "pcs", category: "food" },
      { name: "Daging Ayam", unit: "gram", category: "food" },
      { name: "Saus Sambal", unit: "ml", category: "food" },
      { name: "Mayonaise", unit: "gram", category: "food" },
      { name: "Kotak Makanan", unit: "pcs", category: "packaging" },
    ],
  },
];
