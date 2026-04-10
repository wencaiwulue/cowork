export type Theme = 'light' | 'dark' | 'system';

export const applyTheme = (currentTheme: Theme) => {
  const root = document.documentElement;
  const isDark = currentTheme === 'dark' || 
    (currentTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  if (isDark) {
    root.style.setProperty('--bg-primary', '#1d1d1f');
    root.style.setProperty('--bg-sidebar', '#141416');
    root.style.setProperty('--bg-input', '#2c2c2e');
    root.style.setProperty('--bg-hover', '#3a3a3c');
    root.style.setProperty('--text-primary', '#ffffff');
    root.style.setProperty('--text-secondary', '#8e8e93');
    root.style.setProperty('--border', '#3a3a3c');
    root.style.setProperty('--accent', '#007aff');
  } else {
    root.style.setProperty('--bg-primary', '#ffffff');
    root.style.setProperty('--bg-sidebar', '#f5f5f7');
    root.style.setProperty('--bg-input', '#f0f0f2');
    root.style.setProperty('--bg-hover', '#e5e5e7');
    root.style.setProperty('--text-primary', '#1d1d1f');
    root.style.setProperty('--text-secondary', '#86868b');
    root.style.setProperty('--border', '#d2d2d7');
    root.style.setProperty('--accent', '#007aff');
  }
};

export const initTheme = () => {
  const savedTheme = (localStorage.getItem('app-theme') as Theme) || 'dark';
  applyTheme(savedTheme);
  
  // Listen for system theme changes if set to system
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem('app-theme') === 'system') {
      applyTheme('system');
    }
  });
};
