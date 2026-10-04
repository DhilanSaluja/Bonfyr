import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, typography, shadows, withAlpha } from '@/constants/theme';
import { FlameIcon, CircleMotifIcon, ProfileIcon } from '@/components/icons';
import { useResponsive } from '@/lib/responsive';
import { useAppTheme } from '@/lib/theme-context';

function TabIcon({ name, focused, size }: { name: string; focused: boolean; size: number }) {
  const { colors } = useAppTheme();
  const color = focused ? colors.lamp : colors.charcoalMuted;
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      {focused ? (
        <View
          style={{
            position: 'absolute',
            top: -8,
            width: 5,
            height: 5,
            borderRadius: 2.5,
            backgroundColor: colors.lamp,
            ...shadows.glow,
          }}
        />
      ) : null}
      {name === 'home' ? (
        <FlameIcon size={size} color={color} lit={focused} />
      ) : name === 'circles' ? (
        <CircleMotifIcon size={size} color={color} />
      ) : (
        <ProfileIcon size={size} color={color} />
      )}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const { tabBarBase, rs } = useResponsive();
  const iconSize = rs(24);
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'ios' ? 10 : 8);
  const tabHeight = tabBarBase + bottomPad;

  return (
    <View style={styles.shell}>
      <Tabs
        safeAreaInsets={{ bottom: 0 }}
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: false,
          sceneStyle: { paddingBottom: tabHeight },
          tabBarStyle: {
            ...shadows.soft,
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: withAlpha(colors.surface, 0.72),
            borderTopColor: withAlpha('#FFFFFF', 0.35),
            borderTopWidth: StyleSheet.hairlineWidth,
            height: tabHeight,
            paddingTop: spacing.sm,
            paddingBottom: bottomPad,
            zIndex: 100,
            elevation: 24,
          },
          tabBarActiveTintColor: colors.lamp,
          tabBarInactiveTintColor: colors.charcoalMuted,
          tabBarLabelStyle: {
            ...typography.caption,
            fontFamily: typography.callout.fontFamily,
            fontSize: 11,
            letterSpacing: 0.2,
            marginTop: 2,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarAccessibilityLabel: 'Home',
            tabBarIcon: ({ focused }) => (
              <TabIcon name="home" focused={focused} size={iconSize} />
            ),
          }}
        />
        <Tabs.Screen
          name="circles"
          options={{
            title: 'Crews',
            tabBarAccessibilityLabel: 'Crews',
            tabBarIcon: ({ focused }) => (
              <TabIcon name="circles" focused={focused} size={iconSize} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'You',
            tabBarAccessibilityLabel: 'You',
            tabBarIcon: ({ focused }) => (
              <TabIcon name="profile" focused={focused} size={iconSize} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, overflow: 'hidden' },
});
