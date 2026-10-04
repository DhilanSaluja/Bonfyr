import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Field } from '@/components/ui';
import { radii, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

/** Curated GIF pack so chat works without a Tenor key. */
export const BONFYR_GIFS: { id: string; url: string; label: string }[] = [
  {
    id: 'wave',
    label: 'Wave',
    url: 'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif',
  },
  {
    id: 'fire',
    label: 'Fire',
    url: 'https://media.giphy.com/media/l0MYC0LleWxZURrXy/giphy.gif',
  },
  {
    id: 'yes',
    label: 'Yes',
    url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif',
  },
  {
    id: 'laugh',
    label: 'Laugh',
    url: 'https://media.giphy.com/media/10JhviFC8kZ1ug/giphy.gif',
  },
  {
    id: 'party',
    label: 'Party',
    url: 'https://media.giphy.com/media/l0MYt5jPR19QCF1oA/giphy.gif',
  },
  {
    id: 'heart',
    label: 'Heart',
    url: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif',
  },
  {
    id: 'cool',
    label: 'Cool',
    url: 'https://media.giphy.com/media/3o6Zt6ML6BklcajjsA/giphy.gif',
  },
  {
    id: 'down',
    label: 'Down',
    url: 'https://media.giphy.com/media/26BRv0Thl7I2EXz3O/giphy.gif',
  },
];

type GifProps = {
  visible: boolean;
  onClose: () => void;
  onPick: (url: string) => void;
};

export function GifPickerSheet({ visible, onClose, onPick }: GifProps) {
  const { styles } = useThemedStyles(makeGifStyles);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Send a GIF</Text>
          <ScrollView contentContainerStyle={styles.grid}>
            {BONFYR_GIFS.map((g) => (
              <Pressable
                key={g.id}
                style={styles.gifCell}
                onPress={() => {
                  onPick(g.url);
                  onClose();
                }}
              >
                <Image source={{ uri: g.url }} style={styles.gif} />
                <Text style={styles.gifLabel}>{g.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type PollProps = {
  visible: boolean;
  onClose: () => void;
  onCreate: (question: string, options: string[]) => void;
};

export function PollComposerSheet({ visible, onClose, onCreate }: PollProps) {
  const { colors, styles } = useThemedStyles(makePollStyles);
  const insets = useSafeAreaInsets();
  const [question, setQuestion] = useState('');
  const [optA, setOptA] = useState('');
  const [optB, setOptB] = useState('');
  const [optC, setOptC] = useState('');

  const reset = () => {
    setQuestion('');
    setOptA('');
    setOptB('');
    setOptC('');
  };

  const trimmedQuestion = question.trim();
  const options = [optA, optB, optC].map((o) => o.trim()).filter(Boolean);
  const ready = trimmedQuestion.length > 0 && options.length >= 2;

  const dismiss = () => {
    reset();
    onClose();
  };

  const submit = () => {
    if (!ready) return;
    onCreate(trimmedQuestion, options);
    dismiss();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={dismiss}>
          <Pressable
            style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.handle} />
            <Text style={styles.title}>Crew poll</Text>
            <Text style={styles.sub}>Burns out with chat in 24 hours.</Text>
            <Field
              placeholder="Question"
              value={question}
              onChangeText={setQuestion}
              maxLength={120}
              style={styles.field}
            />
            <TextInput
              style={styles.input}
              placeholder="Option 1"
              placeholderTextColor={colors.charcoalMuted}
              value={optA}
              onChangeText={setOptA}
              maxLength={60}
              accessibilityLabel="Poll option 1"
            />
            <TextInput
              style={styles.input}
              placeholder="Option 2"
              placeholderTextColor={colors.charcoalMuted}
              value={optB}
              onChangeText={setOptB}
              maxLength={60}
              accessibilityLabel="Poll option 2"
            />
            <TextInput
              style={styles.input}
              placeholder="Option 3 (optional)"
              placeholderTextColor={colors.charcoalMuted}
              value={optC}
              onChangeText={setOptC}
              maxLength={60}
              accessibilityLabel="Poll option 3, optional"
            />
            {/* Inline hint instead of a system alert, which can't be themed
                and reads as an error for something the user hasn't finished. */}
            <Text style={styles.hint}>
              {ready ? 'Ready to post.' : 'Add a question and at least two options.'}
            </Text>
            <Button label="Post poll" onPress={submit} disabled={!ready} />
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeGifStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    sheet: {
      maxHeight: '70%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      padding: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: spacing.smd,
    },
    title: { ...typography.heading, color: colors.charcoal, marginBottom: spacing.md },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      paddingBottom: spacing.lg,
    },
    gifCell: {
      width: '47%',
      borderRadius: radii.md,
      overflow: 'hidden',
      backgroundColor: colors.paperDeep,
    },
    gif: { width: '100%', height: 100 },
    gifLabel: {
      ...typography.caption,
      color: colors.charcoal,
      padding: spacing.xs,
      textAlign: 'center',
    },
  });
}

function makePollStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      padding: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: spacing.smd,
    },
    title: { ...typography.heading, color: colors.charcoal },
    sub: {
      ...typography.caption,
      color: colors.charcoalMuted,
      marginBottom: spacing.md,
    },
    field: { marginBottom: spacing.sm },
    input: {
      ...typography.body,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.sm + 2,
      color: colors.charcoal,
      marginBottom: spacing.sm,
      backgroundColor: colors.paper,
    },
    hint: {
      ...typography.caption,
      color: colors.charcoalMuted,
      marginBottom: spacing.smd,
    },
  });
}
