export const contacts = [
  { id: 'phone', label: '+98 905 484 7599', href: 'tel:+989054847599' },
  { id: 'telegram', label: '@OminiCorp', href: 'https://t.me/ominicorp' },
  { id: 'whatsapp', label: '+98 905 484 7599', href: 'https://wa.me/989054847599' },
  { id: 'instagram', label: '@OminiCorp', href: 'https://www.instagram.com/ominicorp' },
];

const services = {
  fa: [
    ['software', 'نرم‌افزار و هوش مصنوعی', 'از اولین ایده تا محصولی که هر روز برایتان کار می‌کند.', ['طراحی سایت و اپلیکیشن موبایل و ویندوز', 'اتوماسیون، اسکریپت‌نویسی و پروژه‌های هوش مصنوعی', 'سئو، امنیت و بهینه‌سازی وب']],
    ['security', 'امنیت و شبکه', 'زیرساختی مطمئن برای کسب‌وکاری که همیشه در جریان است.', ['دوربین مداربسته، دزدگیر و اعلام حریق', 'طراحی و اجرای شبکه LAN/WAN و سرور', 'راه‌اندازی و مدیریت فایروال']],
    ['hardware', 'سخت‌افزار و الکترونیک', 'راهکارهای فنی، از عیب‌یابی قطعه تا اجرای پروژه صنعتی.', ['تعمیرات تخصصی و پروژه‌های صنعتی', 'تست قطعات، گارانتی و برق‌کشی حرفه‌ای', 'تأمین تجهیزات شبکه و کامپیوتر']],
    ['creative', 'طراحی و خلاقیت', 'هویتی که دیده می‌شود و تصویری که در ذهن می‌ماند.', ['طراحی لوگو، بنر، تیزر و موشن گرافیک', 'ویرایش عکس و ویدیو', 'چاپ روی فلز، پارچه و شیشه']],
    ['architecture', 'معماری و ساخت', 'از طراحی روی کاغذ تا ساخت فضایی برای زندگی و کار.', ['طراحی پلان دوبعدی و سه‌بعدی', 'دکوراسیون داخلی و بازسازی', 'ساخت تور مجازی پروژه']],
  ],
  en: [
    ['software', 'Software & AI', 'From the first idea to a product that works for you every day.', ['Web, mobile, and Windows development', 'Automation, scripting, and AI projects', 'SEO, security, and web performance']],
    ['security', 'Security & Networks', 'Reliable infrastructure for a business that never stands still.', ['CCTV, intrusion alarms, and fire detection', 'LAN/WAN design and server deployment', 'Firewall setup and management']],
    ['hardware', 'Hardware & Electronics', 'Hands-on technical support, from diagnostics to industrial projects.', ['Specialist repairs and industrial projects', 'Component testing, warranties, and wiring', 'Computer and networking equipment']],
    ['creative', 'Design & Creative', 'A visual identity that gets noticed and remembered.', ['Logos, banners, promotional videos, and motion graphics', 'Photo and video editing', 'Printing on metal, fabric, and glass']],
    ['architecture', 'Architecture & Build', 'From the first drawing to spaces made for living and working.', ['2D and 3D architectural plans', 'Interior design and renovations', 'Virtual tours for projects']],
  ],
};

export const locales = {
  fa: {
    direction: 'rtl', name: 'هلدینگ اومینی‌کورپ', title: 'اومینی‌کورپ | همه‌چیز، کنار هم',
    description: 'اومینی‌کورپ؛ طراحی و توسعه نرم‌افزار، امنیت و شبکه، سخت‌افزار، طراحی خلاق و معماری در یک مجموعه.',
    alternate: 'EN', alternateName: 'English', skip: 'رفتن به محتوای اصلی', nav: ['خدمات', 'درباره ما', 'تماس با ما'],
    consultation: 'مشاوره پروژه', heroLabel: 'یک مجموعه، چند تخصص', heroHeading: ['از ایده تا اجرا،', 'همه‌چیز کنار هم.'],
    heroBody: 'از نرم‌افزار و هوش مصنوعی تا امنیت، طراحی و معماری؛ تیم‌های تخصصی ما کنار هم‌اند تا ایده‌تان را به نتیجه برسانند.',
    explore: 'کشف خدمات ما', guideAction: 'راهنمای انتخاب', visualLabel: 'پنج حوزهٔ تخصصی',
    domains: ['فناوری', 'امنیت', 'الکترونیک', 'طراحی', 'معماری'],
    servicesLabel: 'کاتالوگ خدمات', servicesHeading: ['تخصص‌های', 'ما'], servicesBody: 'خدمت مورد نیازتان را پیدا کنید و جزئیات آن را ببینید.', details: 'مشاهده جزئیات',
    guideLabel: 'راهنمای پروژه', guideHeading: 'نمی‌دانید از کجا شروع کنید؟', guideBody: 'هدفتان را انتخاب کنید تا خدمات مرتبط را به شما نشان دهیم.', guideButton: 'شروع راهنما',
    goals: ['می‌خواهم آنلاین شروع کنم', 'به امنیت و زیرساخت نیاز دارم', 'می‌خواهم برندم دیده شود', 'بازسازی یا طراحی فضا دارم'],
    recommendation: 'پیشنهاد ما برای شروع',
    aboutLabel: 'روش همکاری', aboutHeading: 'از گفت‌وگوی اول تا اجرا', aboutBody: 'وقتی یک پروژه به چند تخصص نیاز دارد، لازم نیست برای هر بخش از صفر شروع کنید. از یک گفت‌وگو شروع می‌کنیم و با هم مشخص می‌کنیم چه خدماتی به کارتان می‌آید.',
    steps: [['شناخت نیاز', 'درباره پروژه، هدف و محدودیت‌ها صحبت می‌کنیم.'], ['تعیین مسیر', 'خدمات مورد نیاز و محدوده کار را مشخص می‌کنیم.'], ['اجرا و هماهنگی', 'تخصص‌های مرتبط را برای اجرای پروژه کنار هم می‌آوریم.']],
    contactLabel: 'در ارتباط باشیم', contactHeading: 'درباره پروژه‌تان حرف بزنیم.', contactBody: 'از راهی که برایتان راحت‌تر است با ما در ارتباط باشید.', contactNames: ['تلفن', 'تلگرام', 'واتساپ', 'اینستاگرام'],
    secondary: 'شماره دوم', copyright: 'تمامی حقوق محفوظ است.', tv: 'حالت نمایشگر', fullscreen: 'تمام‌صفحه', exitFullscreen: 'خروج از تمام‌صفحه', fullscreenUnavailable: 'تمام‌صفحه در این مرورگر یا پیش‌نمایش در دسترس نیست.', tvLabel: 'معرفی خدمات اومینی‌کورپ', previous: 'قبلی', next: 'بعدی', play: 'پخش خودکار', pause: 'توقف پخش', close: 'بستن', discuss: 'تماس درباره پروژه',
  },
  en: {
    direction: 'ltr', name: 'OminiCorp', title: 'OminiCorp | Everything Together',
    description: 'OminiCorp brings together software, security, electronics, creative design, and architecture.',
    alternate: 'فا', alternateName: 'فارسی', skip: 'Skip to content', nav: ['Services', 'About', 'Contact'],
    consultation: 'Discuss a project', heroLabel: 'One group, five specialties', heroHeading: ['From idea to execution.', 'Everything together.'],
    heroBody: 'From software and AI to security, design, and architecture, our specialists work together to bring your idea to life.',
    explore: 'Explore our services', guideAction: 'Service finder', visualLabel: 'Five specialist areas',
    domains: ['Technology', 'Security', 'Electronics', 'Design', 'Architecture'],
    servicesLabel: 'Service catalog', servicesHeading: ['Our', 'expertise'], servicesBody: 'Find the service you need and explore what it includes.', details: 'View details',
    guideLabel: 'Project Navigator', guideHeading: 'Not sure where to start?', guideBody: 'Pick your goal to see which services fit your project.', guideButton: 'Find my service',
    goals: ['I want to launch online', 'I need security and infrastructure', 'I want my brand to stand out', 'I’m designing or renovating a space'],
    recommendation: 'Where we suggest starting',
    aboutLabel: 'How we work', aboutHeading: 'From first conversation to delivery', aboutBody: 'If your project calls for more than one specialty, you don’t have to start over with each team. We start with one conversation to find out what will help.',
    steps: [['Understand the goal', 'We talk about your project, goals, and constraints.'], ['Define the scope', 'We identify the services and agree what the work will cover.'], ['Build together', 'We bring the right specialties together to do the work.']],
    contactLabel: 'Get in touch', contactHeading: 'Let’s talk about your project.', contactBody: 'Choose the channel that’s most convenient for you.', contactNames: ['Phone', 'Telegram', 'WhatsApp', 'Instagram'],
    secondary: 'Second number', copyright: 'All rights reserved.', tv: 'Display mode', fullscreen: 'Full screen', exitFullscreen: 'Exit full screen', fullscreenUnavailable: 'Full screen is unavailable in this browser or preview.', tvLabel: 'The OminiCorp service collection', previous: 'Previous', next: 'Next', play: 'Autoplay', pause: 'Pause autoplay', close: 'Close', discuss: 'Discuss your project',
  },
};

export function getServices(language) {
  return services[language];
}
