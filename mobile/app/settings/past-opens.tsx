import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, EmptyState, ScreenHeader } from '@/components/ui';
import { spacing, typography, type ThemeColors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchPastOpens } from '@/lib/api';
import type { Open } from '@/lib/types';
import { useThemedStyles } from '@/lib/theme-context';
import { ListSkeleton } from '@/components/Skeleton';

export default function PastOpensScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const router = useRouter();
  const [opens, setOpens] = useState<Open[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let alive = true;
    fetchPastOpens(user.id)
      .then((items) => {
        if (alive) setOpens(items);
      })
      .catch((e) => console.warn('Past sparks load failed', e))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ScreenHeader
          title="Past Sparks"
          subtitle="Lights you've turned on"
        />

        {loading ? (
          <ListSkeleton rows={4} />
        ) : opens.length === 0 ? (
          <EmptyState
            title="No Sparks yet"
            body="Start one when you're free to hang."
          />
        ) : (
          opens.map((open) => (
            <Pressable
              key={open.id}
              onPress={() => router.push(`/open/${open.id}`)}
              accessibilityRole="button"
            >
              <Card style={styles.card} elevated>
                <View style={styles.row}>
                  <Text style={styles.status}>{open.status}</Text>
                  <Text style={styles.date}>
                    {new Date(open.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <Text style={styles.description}>{open.description}</Text>
                <Text style={styles.meta}>
                  {(open.joiners?.length ?? 0)} joined
                </Text>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { padding: spacing.lg },
  card: {
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  status: {
    ...typography.label,
    color: colors.lampDeep,
    textTransform: 'capitalize',
  },
  date: { ...typography.caption, color: colors.charcoalMuted },
  description: { ...typography.bodyMedium, color: colors.charcoal },
  meta: { ...typography.caption, color: colors.charcoalMuted, marginTop: spacing.xs },
  });
}

