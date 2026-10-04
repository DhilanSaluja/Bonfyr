import { useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { hit, motion, radii, shadows, spacing, typography, withAlpha, type ThemeColors } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { safeBack } from '@/lib/nav';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from '@/components/icons';
import { RemoteImage } from '@/components/RemoteImage';

function useUi() {
  const { colors } = useAppTheme();
  return useMemo(() => makeStyles(colors), [colors]);
}

/* ─── Button ─────────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
type ButtonSize = 'md' | 'sm';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function GlassSheen({ radius, intense }: { radius: number; intense?: boolean }) {
  return (
    <>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            borderRadius: radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: intense ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.58)',
            borderBottomColor: 'rgba(255,255,255,0.12)',
            borderRightColor: 'rgba(255,255,255,0.18)',
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 1,
          right: 1,
          height: '48%',
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
          backgroundColor: intense ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.34)',
        }}
      />
    </>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const { colors } = useAppTheme();
  const styles = useUi();
  const radius = size === 'sm' ? radii.xs : radii.md;
  const isDisabled = disabled || loading;
  const glassy = variant !== 'ghost';
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      hitSlop={size === 'sm' ? 6 : 0}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      android_ripple={{ color: 'rgba(255,255,255,0.18)', borderless: false }}
      style={({ pressed }) => [
        styles.btnBase,
        size === 'sm' ? styles.btnSm : styles.btnMd,
        styles[`btn_${variant}`],
        pressed && !isDisabled && styles.btnPressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {glassy ? <GlassSheen radius={radius} intense={variant === 'primary' || variant === 'dark'} /> : null}
      {loading ? (
        <ActivityIndicator
          color={
            variant === 'primary' || variant === 'dark'
              ? colors.onDark
              : variant === 'danger'
                ? colors.danger
                : colors.lampDeep
          }
        />
      ) : (
        <Text style={[styles.btnLabel, styles[`btnLabel_${variant}`]]}>{label}</Text>
      )}
    </Pressable>
  );
}

/* ─── Icon button ───────────────────────────────────────────────────────── */

export function IconButton({
  onPress,
  children,
  accessibilityLabel,
  style,
}: {
  onPress: () => void;
  children: ReactNode;
  accessibilityLabel: string;
  style?: ViewStyle;
}) {
  const styles = useUi();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.iconBtn,
        pressed && styles.btnPressed,
        style,
      ]}
    >
      <GlassSheen radius={radii.sm} />
      <View style={{ zIndex: 1 }}>{children}</View>
    </Pressable>
  );
}

export function PlusCircle({
  onPress,
  accessibilityLabel,
  size = 44,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
}) {
  const { colors } = useAppTheme();
  const styles = useUi();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: 'rgba(255,255,255,0.22)', borderless: false, radius: Math.round(size * 0.4) }}
      style={({ pressed }) => [
        styles.plusCircle,
        { width: size, height: size, borderRadius: radii.sm },
        pressed && styles.btnPressed,
      ]}
    >
      <GlassSheen radius={radii.sm} intense />
      <View style={{ zIndex: 1 }}>
        <PlusIcon size={Math.round(size * 0.48)} color={colors.onDark} />
      </View>
    </Pressable>
  );
}

/* ─── Card / surfaces ───────────────────────────────────────────────────── */

export function Card({
  children,
  style,
  elevated = false,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  padded?: boolean;
}) {
  const styles = useUi();
  return (
    <View
      style={[
        styles.card,
        elevated && shadows.card,
        padded && styles.cardPad,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* ─── Chip (selection) ──────────────────────────────────────────────────── */

export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const styles = useUi();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && !disabled && styles.btnPressed,
        disabled && styles.disabled,
      ]}
    >
      <GlassSheen radius={radii.xs} intense={!!selected} />
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

/* ─── Field ─────────────────────────────────────────────────────────────── */

export function Field({
  label,
  error,
  hint,
  containerStyle,
  style,
  ...inputProps
}: Omit<TextInputProps, 'style'> & {
  label?: string;
  error?: string;
  hint?: string;
  containerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<TextStyle>;
}) {
  const { colors } = useAppTheme();
  const styles = useUi();
  return (
    <View style={[styles.fieldWrap, containerStyle]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.charcoalMuted}
        accessibilityLabel={label ?? (typeof inputProps.placeholder === 'string' ? inputProps.placeholder : undefined)}
        {...inputProps}
        style={[
          styles.fieldInput,
          error ? styles.fieldInputError : null,
          inputProps.multiline && styles.fieldMultiline,
          style,
        ]}
      />
      {error ? (
        <Text style={styles.fieldError} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
}

/* ─── Stat row ──────────────────────────────────────────────────────────── */

export function StatRow({
  items,
  dimmed,
}: {
  items: { value: string | number; label: string }[];
  dimmed?: boolean;
}) {
  const styles = useUi();
  return (
    <View style={[styles.stats, dimmed && styles.dimmed]} accessibilityRole="summary">
      {items.map((item, i) => (
        <View key={item.label} style={styles.statCell}>
          {i > 0 ? <View style={styles.statDivider} /> : null}
          <View style={styles.stat}>
            <Text style={[styles.statNum, dimmed && styles.dimText]}>{item.value}</Text>
            <Text style={styles.statLabel}>{item.label}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/* ─── Banner CTA ────────────────────────────────────────────────────────── */

export function BannerCTA({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useUi();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [styles.banner, pressed && styles.btnPressed]}
    >
      <GlassSheen radius={radii.md} intense />
      <View style={styles.bannerCopy}>
        <Text style={styles.bannerTitle}>{title}</Text>
        <Text style={styles.bannerSub}>{subtitle}</Text>
      </View>
      <View style={{ zIndex: 1 }}>
        <ChevronRightIcon size={20} color={colors.onDark} />
      </View>
    </Pressable>
  );
}

/* ─── Pro upsell ────────────────────────────────────────────────────────── */

export function ProCard({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const styles = useUi();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Bonfyr Pro. ${title}`}
      style={({ pressed }) => [styles.proCard, pressed && styles.pressed]}
    >
      <Text style={styles.proEyebrow}>Bonfyr Pro</Text>
      <Text style={styles.proTitle}>{title}</Text>
      <Text style={styles.proSub}>{subtitle}</Text>
    </Pressable>
  );
}

/* ─── Empty state ───────────────────────────────────────────────────────── */

export function EmptyState({
  title,
  body,
  action,
  illustration,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  illustration?: ReactNode;
}) {
  const styles = useUi();
  return (
    <View style={styles.empty} accessibilityRole="text">
      {illustration ? <View style={styles.emptyHalo}>{illustration}</View> : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action}
    </View>
  );
}

/* ─── Section headers ───────────────────────────────────────────────────── */

export function SectionLabel({ children, dimmed }: { children: string; dimmed?: boolean }) {
  const styles = useUi();
  return (
    <Text style={[styles.sectionLabel, dimmed && styles.dimText]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function SectionHeader({
  title,
  meta,
  dimmed,
}: {
  title: string;
  meta?: string;
  dimmed?: boolean;
}) {
  const styles = useUi();
  return (
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionTitle, dimmed && styles.dimText]} accessibilityRole="header">
        {title}
      </Text>
      {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

/* ─── List row ──────────────────────────────────────────────────────────── */

export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  showChevron = true,
  dimmed,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  dimmed?: boolean;
}) {
  const { colors } = useAppTheme();
  const styles = useUi();
  const copy = (
    <>
      {left}
      <View style={styles.listCopy}>
        <Text style={[styles.listTitle, dimmed && styles.dimText]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.listSub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </>
  );
  const trailing =
    right ??
    (showChevron && onPress ? (
      <ChevronRightIcon size={18} color={colors.charcoalMuted} />
    ) : null);

  if (right) {
    return (
      <View style={styles.listRow}>
        {onPress ? (
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
            style={({ pressed }) => [styles.listMain, pressed && styles.pressed]}
          >
            {copy}
          </Pressable>
        ) : (
          <View style={styles.listMain}>{copy}</View>
        )}
        {trailing}
      </View>
    );
  }

  const content = (
    <>
      {copy}
      {trailing}
    </>
  );

  if (!onPress) {
    return <View style={styles.listRow}>{content}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

/* ─── Top bar ───────────────────────────────────────────────────────────── */

export function TopBar({
  title,
  brand,
  right,
}: {
  title: string;
  brand?: ReactNode;
  right?: ReactNode;
}) {
  const styles = useUi();
  return (
    <View style={styles.topBar}>
      <View style={styles.brandRow}>
        {brand}
        <Text style={styles.topTitle} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {right ? <View style={styles.topActions}>{right}</View> : null}
    </View>
  );
}

/* ─── Screen intro ──────────────────────────────────────────────────────── */

export function ScreenIntro({
  title,
  subtitle,
  dimmed,
}: {
  title: string;
  subtitle: string;
  dimmed?: boolean;
}) {
  const styles = useUi();
  return (
    <View style={styles.intro}>
      <Text style={[styles.introTitle, dimmed && styles.dimText]}>{title}</Text>
      <Text style={styles.introSub}>{subtitle}</Text>
    </View>
  );
}

/* ─── Avatar ────────────────────────────────────────────────────────────── */

export function Avatar({
  name,
  uri,
  size = 44,
  color,
  pro = false,
}: {
  name?: string | null;
  uri?: string | null;
  size?: number;
  color?: string;
  /** Small Pro mark next to the photo for active subscribers */
  pro?: boolean;
}) {
  const { colors } = useAppTheme();
  const fill = color ?? colors.lamp;
  const [failed, setFailed] = useState(false);
  const showImage = !!uri && !failed;
  const label = name ? `${name} avatar` : 'Avatar';

  const face = showImage ? (
    <RemoteImage
      uri={uri}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: fill,
      }}
      resizeMode="cover"
    />
  ) : (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: fill,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: typography.bodyBold.fontFamily,
          fontWeight: '700',
          fontSize: size * 0.36,
          color: colors.onDark,
        }}
      >
        {(name?.trim()?.[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );

  const badgeFs = Math.max(7, Math.round(size * 0.22));
  return (
    <View
      accessibilityLabel={pro ? `${label}, Pro` : label}
      style={{ width: size, height: size, overflow: 'visible' }}
    >
      {face}
      {pro ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -Math.max(2, Math.round(size * 0.06)),
            right: -Math.max(2, Math.round(size * 0.08)),
            paddingHorizontal: Math.max(4, Math.round(size * 0.12)),
            paddingVertical: Math.max(1, Math.round(size * 0.02)),
            borderRadius: radii.pill,
            backgroundColor: colors.lamp,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.cream,
          }}
        >
          <Text
            style={{
              fontFamily: typography.bodyBold.fontFamily,
              fontWeight: '700',
              fontSize: badgeFs,
              lineHeight: badgeFs + 1,
              color: colors.onDark,
              letterSpacing: 0.2,
              textTransform: 'lowercase',
            }}
          >
            pro
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/* ─── Screen header (stack screens) ─────────────────────────────────────── */

export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useUi();
  const router = useRouter();
  const handleBack = onBack ?? (() => safeBack(router));
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
        >
          <ChevronLeftIcon size={24} color={colors.lampBtn} />
        </Pressable>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      {right}
    </View>
  );
}

/* ─── Styles ────────────────────────────────────────────────────────────── */

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    pressed: { opacity: motion.pressOpacity },
    disabled: { opacity: 0.42 },
    dimmed: { opacity: 0.5 },
    dimText: { color: c.lightOff },
    btnPressed: {
      transform: [{ scale: motion.pressScale }],
      opacity: 0.94,
    },

    btnBase: {
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    btnMd: {
      minHeight: hit.min,
      paddingVertical: spacing.smd,
      paddingHorizontal: spacing.lg,
    },
    btnSm: {
      minHeight: 40,
      borderRadius: radii.xs,
      paddingVertical: spacing.sm - 1,
      paddingHorizontal: spacing.md,
    },

    btn_primary: {
      backgroundColor: withAlpha(c.lampBtn, 0.78),
    },
    btn_dark: {
      backgroundColor: withAlpha(c.lampDeep, 0.82),
    },
    btn_secondary: {
      backgroundColor: withAlpha(c.surface, 0.48),
    },
    btn_ghost: {
      backgroundColor: 'transparent',
    },
    btn_danger: {
      backgroundColor: withAlpha(c.danger, 0.14),
    },
    btnLabel: { ...typography.bodyMedium, zIndex: 1 },
    btnLabel_primary: { ...typography.bodyBold, color: c.onDark, zIndex: 1 },
    btnLabel_secondary: { ...typography.bodyBold, color: c.lampDeep, zIndex: 1 },
    btnLabel_ghost: { ...typography.bodyMedium, color: c.lampDeep, zIndex: 1 },
    btnLabel_danger: { ...typography.bodyMedium, color: c.danger, zIndex: 1 },
    btnLabel_dark: { ...typography.bodyBold, color: c.onDark, zIndex: 1 },

    iconBtn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.sm,
      backgroundColor: withAlpha(c.surface, 0.5),
      overflow: 'hidden',
    },
    plusCircle: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(c.lampBtn, 0.8),
      overflow: 'hidden',
    },

    card: {
      backgroundColor: c.surface,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      ...shadows.soft,
    },
    cardPad: {
      padding: spacing.md,
    },

    chip: {
      paddingVertical: spacing.sm - 1,
      paddingHorizontal: spacing.smd + 2,
      borderRadius: radii.xs,
      backgroundColor: withAlpha(c.surface, 0.48),
      minHeight: 38,
      justifyContent: 'center',
      overflow: 'hidden',
    },
    chipSelected: {
      backgroundColor: withAlpha(c.lampBtn, 0.8),
    },
    chipLabel: {
      ...typography.callout,
      fontSize: 15,
      color: c.charcoal,
      lineHeight: 20,
      zIndex: 1,
    },
    chipLabelSelected: {
      color: c.onDark,
    },

    fieldWrap: { gap: spacing.xs },
    fieldLabel: {
      ...typography.callout,
      color: c.charcoalSoft,
    },
    fieldInput: {
      ...typography.body,
      backgroundColor: c.surface,
      borderRadius: radii.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.md + 4,
      paddingHorizontal: spacing.md,
      color: c.charcoal,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      minHeight: hit.min + 8,
      textAlignVertical: 'center',
    },
    fieldMultiline: {
      minHeight: 120,
      textAlignVertical: 'top',
      paddingTop: spacing.md,
      paddingBottom: spacing.md + 4,
    },
    fieldInputError: {
      borderColor: c.danger,
    },
    fieldError: {
      ...typography.caption,
      color: c.danger,
      lineHeight: 22,
      paddingBottom: 2,
    },
    fieldHint: {
      ...typography.caption,
      color: c.charcoalMuted,
      lineHeight: 22,
      paddingBottom: 2,
    },

    stats: {
      marginHorizontal: spacing.md,
      marginBottom: spacing.lg,
      paddingVertical: spacing.md,
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      ...shadows.soft,
    },
    statCell: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    stat: { flex: 1, alignItems: 'center' },
    statNum: { ...typography.title, color: c.ink },
    statLabel: { ...typography.caption, color: c.charcoalMuted, marginTop: 2 },
    statDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'center',
      height: '55%',
      backgroundColor: c.border,
    },

    banner: {
      marginHorizontal: spacing.md,
      marginBottom: spacing.lg,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
      backgroundColor: withAlpha(c.lampBtn, 0.78),
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.smd,
      overflow: 'hidden',
    },
    bannerCopy: { flex: 1, zIndex: 1 },
    bannerTitle: { ...typography.heading, color: c.onDark },
    bannerSub: { ...typography.caption, color: c.onDark, opacity: 0.82, marginTop: 4 },

    proCard: {
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      marginBottom: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.md,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      ...shadows.card,
    },
    proEyebrow: { ...typography.label, color: c.lamp, marginBottom: spacing.xs },
    proTitle: { ...typography.heading, color: c.charcoal },
    proSub: { ...typography.caption, color: c.charcoalMuted, marginTop: 4 },

    empty: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl,
      marginBottom: spacing.md,
      alignItems: 'center',
      gap: spacing.md,
    },
    emptyHalo: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: c.lampSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.xs,
    },
    emptyTitle: { ...typography.heading, color: c.charcoal, textAlign: 'center' },
    emptyBody: {
      ...typography.body,
      color: c.charcoalMuted,
      textAlign: 'center',
      maxWidth: 300,
    },

    sectionLabel: {
      ...typography.label,
      color: c.charcoalMuted,
      paddingHorizontal: spacing.md,
      marginTop: spacing.sm,
      marginBottom: spacing.smd,
    },
    sectionHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      marginBottom: spacing.smd,
    },
    sectionTitle: { ...typography.heading, color: c.charcoal },
    sectionMeta: { ...typography.caption, color: c.charcoalMuted },

    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginHorizontal: spacing.md,
      marginBottom: spacing.smd,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      minHeight: hit.min,
      backgroundColor: c.surface,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      ...shadows.soft,
    },
    listMain: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    listCopy: { flex: 1, minWidth: 0 },
    listTitle: { ...typography.bodyMedium, color: c.charcoal },
    listSub: { ...typography.caption, color: c.charcoalMuted, marginTop: 3 },

    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
      backgroundColor: c.paper,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    topTitle: { ...typography.brand, color: c.ink },
    topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },

    intro: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
    },
    introTitle: { ...typography.title, color: c.charcoal },
    introSub: {
      ...typography.body,
      color: c.charcoalMuted,
      marginTop: spacing.sm,
    },

    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: spacing.md,
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      flex: 1,
    },
    headerTitles: { flex: 1 },
    backBtn: {
      width: hit.min,
      height: hit.min,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -spacing.smd,
      borderRadius: radii.sm,
    },
    headerTitle: {
      ...typography.title,
      color: c.charcoal,
    },
    headerSubtitle: {
      ...typography.caption,
      color: c.charcoalMuted,
      marginTop: 3,
    },
  });
}
