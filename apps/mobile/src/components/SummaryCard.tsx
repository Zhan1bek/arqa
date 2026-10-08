import { StyleSheet, Text, View } from 'react-native';
import { formatTenge, type DaySummary } from '@diary/core';
import { colors, radius } from '../theme';

export function SummaryCard({ summary }: { summary: DaySummary }) {
  return (
    <View style={styles.card} testID="summary">
      <View style={styles.netBlock}>
        <Text style={styles.netLabel}>На руки</Text>
        <Text style={styles.net} testID="summary-net">
          {formatTenge(summary.net)}
        </Text>
      </View>
      <Row label="Поездок" value={String(summary.trips)} />
      <Row label="Выручка" value={formatTenge(summary.revenue)} />
      <Row
        label="Комиссия"
        value={summary.commission > 0 ? formatTenge(-summary.commission) : formatTenge(0)}
        valueStyle={summary.commission > 0 ? styles.negative : undefined}
      />
      <Row
        label="Наличные / карта"
        value={`${formatTenge(summary.cash)} / ${formatTenge(summary.card)}`}
        last
      />
    </View>
  );
}

function Row({
  label,
  value,
  valueStyle,
  last,
}: {
  label: string;
  value: string;
  valueStyle?: object;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, valueStyle]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: 16,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  netBlock: { marginBottom: 8 },
  netLabel: { color: colors.muted, fontSize: 13 },
  net: { color: colors.text, fontSize: 32, fontWeight: '700', fontVariant: ['tabular-nums'] },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  label: { color: colors.muted, fontSize: 15 },
  value: { color: colors.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  negative: { color: colors.negative },
});
