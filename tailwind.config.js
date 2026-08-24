export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-alt': 'rgb(var(--surface-alt) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        label: 'rgb(var(--label) / <alpha-value>)',
        'label-2': 'rgb(var(--label-2) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-hover': 'rgb(var(--accent-hover) / <alpha-value>)',
        destructive: 'rgb(var(--destructive) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        // Full rgba strings — used without opacity modifiers.
        separator: 'var(--separator)',
        fill: 'var(--fill)',
        'fill-hover': 'var(--fill-hover)',
      },
    },
  },
  plugins: [],
};
