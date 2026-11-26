import { z } from 'zod';

export const categorySlug = z.string().min(2).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const categoryThemes = {
  mint: { icon: '⌘', label: 'سبز' },
  blue: { icon: '◈', label: 'آبی' },
  cyan: { icon: '✦', label: 'فیروزه‌ای' },
  amber: { icon: '◇', label: 'کهربایی' },
  violet: { icon: '✳', label: 'بنفش' },
};
const label = z.string().trim().min(2).max(52);
const description = z.string().trim().max(180).default('');
export const categorySchema = z.object({ slug: categorySlug, nameFa: label, nameEn: label,
  descriptionFa: description, descriptionEn: description, theme: z.enum(Object.keys(categoryThemes)).default('mint'),
  position: z.number().int().min(0).max(1000).default(100) });
export const defaultCategories = [
  { slug: 'engineering', nameFa: 'مهندسی', nameEn: 'Engineering', descriptionFa: 'ساخت محصول و بهبود عملکرد وب', descriptionEn: 'Building products and making the web faster', theme: 'mint', position: 10 },
  { slug: 'security', nameFa: 'امنیت', nameEn: 'Security', descriptionFa: 'امنیت عملی برای تیم‌ها و محصولات', descriptionEn: 'Practical security for teams and products', theme: 'blue', position: 20 },
  { slug: 'ai', nameFa: 'هوش مصنوعی', nameEn: 'Artificial intelligence', descriptionFa: 'کاربردها و تصمیم‌های عملی در هوش مصنوعی', descriptionEn: 'Practical applications and AI decisions', theme: 'cyan', position: 30 },
  { slug: 'design', nameFa: 'طراحی', nameEn: 'Design', descriptionFa: 'تجربهٔ کاربر، رابط و طراحی محصول', descriptionEn: 'User experience, interfaces, and product design', theme: 'amber', position: 40 },
];
export const maxCategories = 30;
export const categoryName = (category, lang) => (lang === 'fa' ? category?.nameFa : category?.nameEn) || '';
export const categoryDescription = (category, lang) => (lang === 'fa' ? category?.descriptionFa : category?.descriptionEn) || '';
export class CategoryError extends Error {}
