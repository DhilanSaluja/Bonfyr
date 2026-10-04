import { Dimensions, PixelRatio, Platform, useWindowDimensions } from 'react-native';

/** Design reference  -  iPhone 14 / common Android mid size */
const BASE_WIDTH = 390;
const BASE_HEIGHT = 844;

function windowSize() {
  return Dimensions.get('window');
}

function snap(n: number): number {
  return PixelRatio.roundToNearestPixel(n);
}

/**
 * Readable column on tablets. Never used to *stretch* a phone layout —
 * that is what made Bonfyr look blurry on iPad.
 */
export function contentWidth(width = windowSize().width): number {
  if (width < 700) return width;
  return Math.min(width, 820);
}

/** Width as a fraction of the usable layout (0-100 → px). */
export function wp(percent: number): number {
  return snap((percent / 100) * contentWidth());
}

/** Height as a fraction of the screen (0-100 → px). */
export function hp(percent: number): number {
  const { height } = windowSize();
  return snap((percent / 100) * height);
}

/**
 * Scale a design-token size by screen width.
 * Tablets get a small bump, never a 2× stretch (that looks soft).
 */
export function rs(size: number, minFactor = 0.92, maxFactor = 1.18): number {
  const { width } = windowSize();
  const short = Math.min(width, windowSize().height);
  const factor = Math.min(maxFactor, Math.max(minFactor, short / BASE_WIDTH));
  return snap(size * factor);
}

/** Hook for components that should re-layout on rotation / split-screen. */
export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;
  const col = contentWidth(width);
  return {
    width,
    height,
    isTablet,
    contentWidth: col,
    /** @deprecated same as contentWidth — native px, not a stretched 480pt canvas */
    cappedWidth: col,
    wp: (percent: number) => snap((percent / 100) * col),
    hp: (percent: number) => snap((percent / 100) * height),
    rs: (size: number, minFactor = 0.92, maxFactor = 1.18) => {
      const short = Math.min(width, height);
      const factor = Math.min(maxFactor, Math.max(minFactor, short / BASE_WIDTH));
      return snap(size * factor);
    },
    fireCardWidth: snap(Math.min(col * 0.4, 220)),
    fireRingSize: snap(Math.min(col * 0.26, 148)),
    crewRingSize: snap(Math.min(col * 0.72, height * 0.34, 420)),
    mapHeight: snap(Math.min(height * 0.22, 280)),
    logoSize: snap(Math.min(col * 0.28, 160)),
    heroLogo: snap(Math.min(col * 0.18, 96)),
    tabBarBase: Platform.OS === 'ios' ? 52 : 58,
  };
}

export { BASE_WIDTH, BASE_HEIGHT };
