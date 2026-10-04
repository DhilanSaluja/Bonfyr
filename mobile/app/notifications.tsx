import { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { fetchNotificationHistory, markNotificationsRead } from '@/lib/api';
import { canOpenNotificationLog, openNotificationLog } from '@/lib/notifications';
import type { NotificationLog } from '@/lib/types';
import { spacing, radii, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { EmptyState, ListRow, ScreenHeader } from '@/components/ui';
import { ListSkeleton } from '@/components/Skeleton';

export default function NotificationsScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const items = await fetchNotificationHistory(user.id, 50);
        if (!alive) return;
        setNotifications(items as NotificationLog[]);
        await markNotificationsRead(user.id).catch(() => {});
      } catch (e) {
        console.warn('Notifications load failed', e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ScreenHeader
          title="Notifications"
          subtitle="Sparks, chats, photos, reactions, and fire updates"
        />

        {loading ? (
          <ListSkeleton rows={5} />
        ) : notifications.length === 0 ? (
          <EmptyState
            title="All quiet"
            body="When someone in your Crews sparks, chats, posts, or reacts, it'll show up here."
          />
        ) : (
          notifications.map((n) => {
            const canOpen = canOpenNotificationLog(n);
            return (
              <ListRow
                key={n.id}
                title={n.title}
                subtitle={`${n.body}\n${new Date(n.created_at).toLocaleString()}`}
                left={<View style={[styles.dot, !n.read_at && styles.dotUnread]} />}
                onPress={canOpen ? () => openNotificationLog(n) : undefined}
                showChevron={canOpen}
              />
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.paper },
    scroll: { padding: spacing.lg },
    dot: {
      width: 8,
      height: 8,
      borderRadius: radii.xs,
      marginTop: 6,
      backgroundColor: colors.border,
    },
    dotUnread: { backgroundColor: colors.lamp },
  });
}
