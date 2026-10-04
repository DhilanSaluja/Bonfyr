import { Image } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors as fallbackColors } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';

function useIconColor(color?: string, fallback: keyof typeof fallbackColors = 'charcoal') {
  const { colors } = useAppTheme();
  return color ?? colors[fallback];
}

interface IconProps {
  size?: number;
  color?: string;
  lit?: boolean;
}

export function CircleMotifIcon({ size = 24, color }: IconProps) {
  const stroke = useIconColor(color, 'ember');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="3.6" stroke={stroke} strokeWidth="1.8" />
      <Circle cx="6.2" cy="16.2" r="2.8" stroke={stroke} strokeWidth="1.8" opacity="0.75" />
      <Circle cx="17.8" cy="16.2" r="2.8" stroke={stroke} strokeWidth="1.8" opacity="0.75" />
      <Path
        d="M9.2 11.2C9.4 13.4 10.5 15 12 15C13.5 15 14.6 13.4 14.8 11.2"
        stroke={stroke}
        strokeWidth="1.8"
        opacity="0.45"
      />
    </Svg>
  );
}

export function ProfileIcon({ size = 24, color }: IconProps) {
  const stroke = useIconColor(color, 'charcoalMuted');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="3.5" stroke={stroke} strokeWidth="1.8" />
      <Path
        d="M5 19.5C5.8 15.8 8.4 14 12 14C15.6 14 18.2 15.8 19 19.5"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function BellIcon({ size = 22, color }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 16.5V10.2C6 6.9 8.7 4.2 12 4.2C15.3 4.2 18 6.9 18 10.2V16.5"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Path
        d="M4.5 16.5H19.5"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Path
        d="M10.2 19.2C10.5 20.1 11.2 20.7 12 20.7C12.8 20.7 13.5 20.1 13.8 19.2"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Path d="M12 3.2V4.2" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function SendArrowIcon({ size = 18, color }: IconProps) {
  const stroke = useIconColor(color, 'onDark');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 19V5M12 5L6.5 10.5M12 5L17.5 10.5"
        stroke={stroke}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function SettingsIcon({ size = 22, color }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10.15 3.7h3.7l.38 2.12c.48.14.93.36 1.34.64l2.04-.78 1.85 3.2-1.66 1.32c.08.48.12.98.12 1.5s-.04 1.02-.12 1.5l1.66 1.32-1.85 3.2-2.04-.78c-.41.28-.86.5-1.34.64l-.38 2.12h-3.7l-.38-2.12a6.6 6.6 0 0 1-1.34-.64l-2.04.78-1.85-3.2 1.66-1.32A6.5 6.5 0 0 1 5.9 12c0-.52.04-1.02.12-1.5L4.36 9.18l1.85-3.2 2.04.78c.41-.28.86-.5 1.34-.64L10.15 3.7Z"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="12" r="2.55" stroke={stroke} strokeWidth="1.75" />
    </Svg>
  );
}

export function PlusIcon({ size = 22, color }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5V19" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M5 12H19" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function ChevronRightIcon({ size = 20, color }: IconProps) {
  const stroke = useIconColor(color, 'charcoalMuted');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 6L15 12L9 18"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Navigation back. Replaces the "‹" text glyph the chat header used to draw. */
export function ChevronLeftIcon({ size = 24, color }: IconProps) {
  const stroke = useIconColor(color, 'lampBtn');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 5L8 12L15 19"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CloseIcon({ size = 20, color }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6L18 18" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
      <Path d="M18 6L6 18" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
    </Svg>
  );
}

export function CameraIcon({ size = 22, color }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 8.2C4.5 7.2 5.3 6.4 6.3 6.4H8.1L9.2 4.8C9.4 4.5 9.8 4.3 10.2 4.3H13.8C14.2 4.3 14.6 4.5 14.8 4.8L15.9 6.4H17.7C18.7 6.4 19.5 7.2 19.5 8.2V17C19.5 18 18.7 18.8 17.7 18.8H6.3C5.3 18.8 4.5 18 4.5 17V8.2Z"
        stroke={stroke}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="12.2" r="3.1" stroke={stroke} strokeWidth="1.7" />
    </Svg>
  );
}

export function PhotoIcon({ size = 22, color }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7.5C4 6.4 4.9 5.5 6 5.5H18C19.1 5.5 20 6.4 20 7.5V16.5C20 17.6 19.1 18.5 18 18.5H6C4.9 18.5 4 17.6 4 16.5V7.5Z"
        stroke={stroke}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <Circle cx="9.2" cy="10" r="1.3" stroke={stroke} strokeWidth="1.5" />
      <Path
        d="M4.4 15.6L8.6 11.9L12.3 15.1L15.4 12.6L19.6 16"
        stroke={stroke}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PollIcon({ size = 22, color }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 19V11" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
      <Path d="M12 19V5" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
      <Path d="M18 19V14" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
    </Svg>
  );
}

export function StickerIcon({ size = 22, color }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 7C4.5 5.6 5.6 4.5 7 4.5H17C18.4 4.5 19.5 5.6 19.5 7V13L13 19.5H7C5.6 19.5 4.5 18.4 4.5 17V7Z"
        stroke={stroke}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <Path
        d="M19.5 13H14.5C13.7 13 13 13.7 13 14.5V19.5"
        stroke={stroke}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PlayIcon({ size = 22, color }: IconProps) {
  const fill = useIconColor(color, 'onDark');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8.5 6.2L18 12L8.5 17.8V6.2Z" fill={fill} />
    </Svg>
  );
}

export function AlertIcon({ size = 16, color }: IconProps) {
  const stroke = useIconColor(color, 'danger');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8.6" stroke={stroke} strokeWidth="1.9" />
      <Path d="M12 7.6V12.8" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
      <Path d="M12 15.8V16.4" stroke={stroke} strokeWidth="2.1" strokeLinecap="round" />
    </Svg>
  );
}

export function EditIcon({ size = 22, color }: IconProps) {
  const stroke = useIconColor(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14.5 5.5L18.5 9.5M4 20L5.2 15.2L16.5 3.9C17.1 3.3 18.1 3.3 18.7 3.9L20.1 5.3C20.7 5.9 20.7 6.9 20.1 7.5L8.8 18.8L4 20Z"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Home tab mark - outline flame, not the full mascot. */
export function FlameIcon({ size = 28, color, lit: _lit }: IconProps) {
  const stroke = useIconColor(color, 'lamp');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3C10.2 6.2 7.5 8.8 7.5 13C7.5 16.6 9.6 19.5 12 19.5C14.4 19.5 16.5 16.6 16.5 13C16.5 8.8 13.8 6.2 12 3Z"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 10C11.2 11.4 10.5 12.5 10.5 14C10.5 15.4 11.1 16.5 12 16.5C12.9 16.5 13.5 15.4 13.5 14C13.5 12.5 12.8 11.4 12 10Z"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CommentIcon({ size = 20, color }: IconProps) {
  const stroke = useIconColor(color, 'charcoalMuted');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 6.5C5 5.7 5.7 5 6.5 5H17.5C18.3 5 19 5.7 19 6.5V14.5C19 15.3 18.3 16 17.5 16H10L6 19V16H6.5C5.7 16 5 15.3 5 14.5V6.5Z"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Official Bonfyr mark. muted uses logo-out.png.
 * muted uses logo-out.png. face / expressive kept for call-site compatibility.
 */
export function BonfyrLogo({
  size = 32,
  muted = false,
  face: _face = true,
  expressive: _expressive = false,
}: {
  size?: number;
  muted?: boolean;
  face?: boolean;
  expressive?: boolean;
}) {
  return (
    <Image
      source={muted ? require('../assets/logo-out.png') : require('../assets/logo.png')}
      accessibilityLabel={muted ? 'Bonfyr fire out' : 'Bonfyr'}
      style={{
        width: size,
        height: size,
      opacity: muted ? 0.95 : 1,
      }}
      resizeMode="contain"
    />
  );
}
