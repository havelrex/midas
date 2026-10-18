import { useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { CheckoutStatus } from '../../shared/contracts';
import { useAuth } from '../features/auth/AuthProvider';
import { useLibrary } from '../features/library/hooks';
import { colors } from '../lib/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// Same order and wording as the Library sections, so the counts match what's there.
const COUNTS: { status: CheckoutStatus; label: string }[] = [
  { status: 'watching', label: 'Watching' },
  { status: 'none', label: 'Saved' },
  { status: 'purchased', label: 'Purchased' },
];

// Sheet over the camera (bottom-right button). pageSheet gives the native grabber and swipe-down to close.
export default function ProfileScreen({ visible, onClose }: Props) {
  return (
    <Modal visible={visible} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <ProfileContent onClose={onClose} />
    </Modal>
  );
}

function ProfileContent({ onClose }: { onClose: () => void }) {
  const { session, signOut } = useAuth();
  const { items, loading, error } = useLibrary();
  const [signingOut, setSigningOut] = useState(false);

  const confirmSignOut = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Sign out?',
        message: 'Your saved items stay in your account.',
        options: ['Sign out', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      async (index) => {
        if (index !== 0) return;
        setSigningOut(true);
        // App.tsx swaps to sign-in once the session is gone, which also removes this sheet.
        await signOut();
      },
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.navBar}>
        <Text style={styles.navTitle} accessibilityRole="header">
          Profile
        </Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={({ pressed }) => [styles.done, pressed && styles.pressed]}
        >
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionHeader}>Account</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Email</Text>
            <Text style={styles.rowValue} numberOfLines={1}>
              {session?.user.email ?? '—'}
            </Text>
          </View>
        </View>

        {/* If the library can't load, hide the counts but keep the email and sign out usable. */}
        {!error && (
          <>
            <Text style={styles.sectionHeader}>Your items</Text>
            <View style={styles.group}>
              {COUNTS.map(({ status, label }, i) => (
                <View key={status}>
                  {i > 0 && <View style={styles.separator} />}
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>{label}</Text>
                    <Text style={styles.rowValue}>
                      {loading ? '–' : items.filter((item) => item.checkout_status === status).length}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={[styles.group, styles.signOutGroup]}>
          <Pressable
            onPress={confirmSignOut}
            disabled={signingOut}
            accessibilityRole="button"
            accessibilityState={{ disabled: signingOut, busy: signingOut }}
            style={({ pressed }) => [styles.row, styles.signOutRow, pressed && styles.rowPressed]}
          >
            {signingOut ? (
              <ActivityIndicator color={colors.secondaryLabel} />
            ) : (
              <Text style={styles.signOutText}>Sign out</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.groupedBackground },
  navBar: { height: 56, alignItems: 'center', justifyContent: 'center' },
  navTitle: { color: colors.label, fontSize: 17, fontWeight: '600' },
  done: { position: 'absolute', right: 8, minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: 'center' },
  doneText: { color: colors.tint, fontSize: 17, fontWeight: '600' },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  sectionHeader: {
    color: colors.secondaryLabel,
    fontSize: 13,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  group: { backgroundColor: colors.cell, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 16, gap: 16 },
  rowPressed: { backgroundColor: colors.fill },
  rowLabel: { color: colors.label, fontSize: 17 },
  rowValue: { color: colors.secondaryLabel, fontSize: 17, flexShrink: 1, fontVariant: ['tabular-nums'] },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: 16 },
  signOutGroup: { marginTop: 32 },
  signOutRow: { justifyContent: 'center' },
  signOutText: { color: colors.destructive, fontSize: 17 },
  pressed: { opacity: 0.5 },
});
