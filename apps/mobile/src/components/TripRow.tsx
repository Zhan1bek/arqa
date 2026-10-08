import { StyleSheet, Text, View } from 'react-native';
import { formatTenge } from '@diary/core';
import type { TripView } from '../lib/api';
import { formatTime } from '../lib/format';
import { colors, radius } from '../theme';

const PAYMENT_LABEL = { cash: 'нал.', card: 'карта' } as const;

export function TripRow({ trip }: { trip: TripView }) {
  return (
    <View style={styles.row} testID={`trip-${trip.id}`}>
      <View>
        <Text style={styles.time}>
          {formatTime(trip.start)}–{formatTime(trip.end)}
        </Text>
        <Text style={styles.meta}>комиссия {formatTenge(trip.commission)}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.amount}>{formatTenge(trip.amount)}</Text>
        <Text style={[styles.badge, trip.payment === 'cash' ? styles.cash : styles.card]}>
          {PAYMENT_LABEL[trip.payment]}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  time: { color: colors.text, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  amount: { color: colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  badge: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  cash: { color: colors.cash },
  card: { color: colors.card_ },
});
