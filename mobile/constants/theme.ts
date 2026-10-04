import { Platform } from 'react-native';
import { rs } from '@/lib/responsive';

/**
 * Bonfyr design tokens.
 * Warm paper + one flame accent. Linear density, iOS softness, 4K saturation.
 */

export type ThemeColors = {
  ink: string;
  dusk: string;
  charcoal: string;
  charcoalSoft: string;
  charcoalMuted: string;
  paper: string;
  paperDeep: string;
  warmWhite: string;
  surface: string;
  lamp: string;
  lampBtn: string;
  lampBright: string;
  lampDeep: string;
  lampSoft: string;
  lampMid: string;
  moss: string;
  skyDusk: string;
  border: string;
  borderStrong: string;
  danger: string;
  dangerSoft: string;
  success: string;
  overlay: string;
  onDarkMuted: string;
  onDark: string;
  lightOff: string;
  lightOn: string;
  cream: string;
  creamDark: string;
  ember: string;
  amber: string;
  amberGlow: string;
  amberDeep: string;
  terracotta: string;
  terracottaSoft: string;
};

const lamp = '#FF4E12';
const lampBtn = '#E06A3A';
const lampBright = '#FF8A4A';
const lampDeep = '#C24A22';

export const lightColors: ThemeColors = {
  ink: '#1A120C',
  dusk: '#241C16',
  charcoal: '#2A221C',
  charcoalSoft: '#5A4E44',
  charcoalMuted: '#7A6E64',
  paper: '#FFF6EB',
  paperDeep: '#F3E6D4',
  warmWhite: '#FFF6EB',
  surface: '#FFFCF7',
  lamp,
  lampBtn,
  lampBright,
  lampDeep,
  lampSoft: 'rgba(224, 106, 58, 0.14)',
  lampMid: 'rgba(224, 106, 58, 0.28)',
  moss: '#2F8A5B',
  skyDusk: '#5B8AA0',
  border: 'rgba(42, 32, 21, 0.08)',
  borderStrong: 'rgba(42, 32, 21, 0.14)',
  danger: '#E11D48',
  dangerSoft: 'rgba(225, 29, 72, 0.1)',
  success: '#16A34A',
  overlay: 'rgba(255, 246, 235, 0.82)',
  onDarkMuted: 'rgba(255, 252, 250, 0.64)',
  onDark: '#FFF8F2',
  lightOff: '#A89F96',
  lightOn: '#FFD2A8',
  cream: '#FFF6EB',
  creamDark: '#F3E6D4',
  ember: lamp,
  amber: lamp,
  amberGlow: lampBright,
  amberDeep: lampDeep,
  terracotta: lamp,
  terracottaSoft: lampBright,
};

export const darkColors: ThemeColors = {
  ink: '#FFF6EB',
  dusk: '#FFF6EB',
  charcoal: '#FFF6EB',
  charcoalSoft: '#E8D5C4',
  charcoalMuted: '#C4B09C',
  paper: '#1A120C',
  paperDeep: '#241C16',
  warmWhite: '#1A120C',
  surface: '#2A221C',
  lamp,
  lampBtn,
  lampBright,
  lampDeep,
  lampSoft: 'rgba(224, 106, 58, 0.24)',
  lampMid: 'rgba(224, 106, 58, 0.36)',
  moss: '#3DCA7A',
  skyDusk: '#7EB4C9',
  border: 'rgba(255, 246, 235, 0.12)',
  borderStrong: 'rgba(255, 246, 235, 0.2)',
  danger: '#FB7185',
  dangerSoft: 'rgba(251, 113, 133, 0.16)',
  success: '#4ADE80',
  overlay: 'rgba(26, 18, 12, 0.72)',
  onDarkMuted: 'rgba(255, 246, 235, 0.7)',
  onDark: '#FFF8F2',
  lightOff: '#8A7E74',
  lightOn: '#FFD2A8',
  cream: '#1A120C',
  creamDark: '#241C16',
  ember: lamp,
  amber: lamp,
  amberGlow: lampBright,
  amberDeep: lampDeep,
  terracotta: lamp,
  terracottaSoft: lampBright,
};

/** Default (light)  -  screens that import `colors` stay Bonfyr-warm. */
export const colors = lightColors;

/** Crew color swatches  -  richer, still on-brand */
export const crewSwatches = [
  '#E06A3A',
  '#F0A03A',
  '#3D9A62',
  '#4F90B0',
  '#C4894A',
  '#D46A6A',
] as const;

export const spacing = {
  xs: rs(4),
  sm: rs(8),
  smd: rs(12),
  md: rs(18),
  lg: rs(28),
  xl: rs(36),
  xxl: rs(48),
} as const;

/** Shape ladder: xs/sm surfaces, md buttons, lg sheets, pill only for chips/badges. */
export const radii = {
  xs: rs(6),
  sm: rs(10),
  md: rs(12),
  lg: rs(14),
  xl: rs(16),
  xxl: rs(20),
  pill: 999,
} as const;

export const fonts = {
  display: 'Outfit_700Bold',
  displaySemi: 'Outfit_600SemiBold',
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semi: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
} as const;

const fontFallback = Platform.select({
  ios: undefined,
  android: 'sans-serif',
  default: undefined,
});

/** San Francisco on iOS — native pixels, no webfont raster. Jakarta on Android. */
function uiFont(weight: '400' | '500' | '600' | '700') {
  if (Platform.OS === 'ios') {
    return { fontWeight: weight };
  }
  const family =
    weight === '400'
      ? fonts.regular
      : weight === '500'
        ? fonts.medium
        : weight === '600'
          ? fonts.semi
          : fonts.bold;
  return { fontFamily: family };
}

/** Extra bottom room so descenders (g, y, j, p) never clip in RN Text. */
const descenderPad = Platform.select({ ios: 1, android: 2, default: 1 }) ?? 1;

const sharpText = {
  includeFontPadding: false as const,
  paddingBottom: descenderPad,
};

export const typography = {
  display: {
    fontFamily: fonts.display,
    fontSize: rs(34),
    lineHeight: rs(40),
    letterSpacing: -0.4,
    ...sharpText,
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: rs(24),
    lineHeight: rs(30),
    letterSpacing: -0.3,
    ...sharpText,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: rs(26),
    lineHeight: rs(32),
    letterSpacing: -0.35,
    ...sharpText,
  },
  heading: {
    fontFamily: fonts.displaySemi,
    fontSize: rs(18),
    lineHeight: rs(24),
    letterSpacing: -0.2,
    ...sharpText,
  },
  body: {
    ...uiFont('400'),
    fontSize: rs(17),
    lineHeight: rs(22),
    letterSpacing: -0.41,
    ...sharpText,
  },
  bodyMedium: {
    ...uiFont('500'),
    fontSize: rs(17),
    lineHeight: rs(22),
    letterSpacing: -0.41,
    ...sharpText,
  },
  bodyBold: {
    ...uiFont('700'),
    fontSize: rs(17),
    lineHeight: rs(22),
    letterSpacing: -0.41,
    ...sharpText,
  },
  callout: {
    ...uiFont('600'),
    fontSize: rs(15),
    lineHeight: rs(20),
    letterSpacing: -0.24,
    ...sharpText,
  },
  caption: {
    ...uiFont('400'),
    fontSize: rs(13),
    lineHeight: rs(18),
    letterSpacing: -0.08,
    ...sharpText,
  },
  label: {
    ...uiFont('600'),
    fontSize: rs(12),
    lineHeight: rs(16),
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
    ...sharpText,
  },
  chat: {
    ...uiFont('400'),
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.41,
    ...sharpText,
  },
} as const;

export const shadows = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  soft: {
    shadowColor: '#2A1808',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  card: {
    shadowColor: '#2A1808',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  raised: {
    shadowColor: '#2A1808',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 6,
  },
  lift: {
    shadowColor: '#2A1808',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.16,
    shadowRadius: 40,
    elevation: 10,
  },
  glow: {
    shadowColor: lampBtn,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
} as const;

export const motion = {
  pressScale: 0.98,
  pressOpacity: 0.92,
  durationFast: 160,
  duration: 200,
  durationSlow: 280,
} as const;

export const hit = {
  min: 48,
  icon: 44,
} as const;

/** Apply an alpha to #RGB, #RRGGBB, rgb(), or rgba(). */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith('rgba(')) {
    const inner = color.slice(5, -1).split(',').map((p) => p.trim());
    return `rgba(${inner[0]}, ${inner[1]}, ${inner[2]}, ${a})`;
  }
  if (color.startsWith('rgb(')) {
    return `rgba(${color.slice(4, -1)}, ${a})`;
  }
  let hex = color.replace('#', '');
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  const n = parseInt(hex.slice(0, 6), 16);
  if (Number.isNaN(n)) return color;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export { fontFallback };
