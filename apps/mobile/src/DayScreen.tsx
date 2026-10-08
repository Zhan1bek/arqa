import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { shiftLocalDate } from '@diary/core';
import { createApiClient } from './lib/api';
import { deviceToday, formatDay } from './lib/format';
import { useDay } from './useDay';
import { SummaryCard } from './components/SummaryCard';
import { TripRow } from './components/TripRow';
import { AddTripSheet } from './components/AddTripSheet';
import { API_URL } from './config';
import { colors } from './theme';

export function DayScreen() {
  const api = useMemo(() => createApiClient({ baseUrl: API_URL }), []);
  const today = deviceToday();
  const [date, setDate] = useState(today);
  const [latestDay, setLatestDay] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { state, reload } = useDay(api, date);
  const day = formatDay(date);

  // Used for the "jump to the last shift" shortcut on empty days.
  useEffect(() => {
    const controller = new AbortController();
    api
      .listDays(controller.signal)
      .then(({ days }) => setLatestDay(days[0]?.date ?? null))
      .catch(() => setLatestDay(null));
    return () => controller.abort();
  }, [api, state.status]);

  const data = state.data;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.container}>
        <Text style={styles.appTitle}>Дневник смен</Text>

        <View style={styles.nav}>
          <NavButton
            label="‹"
            testID="prev-day"
            onPress={() => setDate(shiftLocalDate(date, -1))}
          />
          <View style={styles.navCenter}>
            <Text style={styles.dayTitle} testID="day-title">
              {day.title}
            </Text>
            <Text style={styles.daySubtitle}>
              {date === today ? `сегодня, ${day.subtitle}` : day.subtitle}
            </Text>
          </View>
          <NavButton label="›" testID="next-day" onPress={() => setDate(shiftLocalDate(date, 1))} />
        </View>

        {date !== today && (
          <Pressable onPress={() => setDate(today)} style={styles.todayChip}>
            <Text style={styles.todayChipText}>К сегодняшнему дню</Text>
          </Pressable>
        )}

        {state.status === 'error' && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Не удалось загрузить день: {state.message}</Text>
            <Pressable onPress={reload}>
              <Text style={styles.retry}>Повторить</Text>
            </Pressable>
          </View>
        )}

        {!data && state.status === 'loading' ? (
          <ActivityIndicator style={styles.loader} size="large" color={colors.muted} />
        ) : data ? (
          <FlatList
            data={data.trips}
            keyExtractor={(trip) => trip.id}
            renderItem={({ item }) => <TripRow trip={item} />}
            ListHeaderComponent={
              <>
                <SummaryCard summary={data.summary} />
                {data.trips.length > 0 && <Text style={styles.section}>Поездки</Text>}
              </>
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>За этот день поездок нет</Text>
                {latestDay && latestDay !== date && (
                  <Pressable onPress={() => setDate(latestDay)}>
                    <Text style={styles.retry}>
                      Последняя смена: {formatDay(latestDay).title} →
                    </Text>
                  </Pressable>
                )}
              </View>
            }
            refreshControl={
              <RefreshControl refreshing={state.status === 'loading'} onRefresh={reload} />
            }
            contentContainerStyle={styles.list}
          />
        ) : null}
      </View>

      {data && (
        <Pressable
          testID="add-trip"
          style={styles.fab}
          onPress={() => setAdding(true)}
          accessibilityRole="button"
        >
          <Text style={styles.fabText}>+ Поездка</Text>
        </Pressable>
      )}

      {adding && data && (
        <AddTripSheet
          api={api}
          date={date}
          utcOffset={data.utcOffset}
          dayTitle={`${day.title}, ${day.subtitle}`}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </SafeAreaView>
  );
}

function NavButton(props: { label: string; testID: string; onPress: () => void }) {
  return (
    <Pressable
      testID={props.testID}
      onPress={props.onPress}
      style={styles.navButton}
      hitSlop={8}
      accessibilityRole="button"
    >
      <Text style={styles.navButtonText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 16 },
  appTitle: { fontSize: 15, fontWeight: '600', color: colors.muted, marginTop: 8 },
  nav: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
  navCenter: { flex: 1, alignItems: 'center' },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  navButtonText: { fontSize: 26, lineHeight: 28, color: colors.text },
  dayTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
  daySubtitle: { color: colors.muted, marginTop: 2 },
  todayChip: { alignSelf: 'center', marginBottom: 12 },
  todayChipText: { color: colors.card_, fontWeight: '600' },
  loader: { marginTop: 48 },
  list: { paddingBottom: 96 },
  section: { fontSize: 13, color: colors.muted, marginBottom: 8, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyText: { color: colors.muted, fontSize: 15 },
  errorBox: { backgroundColor: '#FEF2F2', borderRadius: 12, padding: 12, marginBottom: 12 },
  errorText: { color: colors.negative },
  retry: { color: colors.card_, fontWeight: '600', marginTop: 4 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    backgroundColor: colors.accent,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  fabText: { fontWeight: '700', fontSize: 16, color: colors.accentText },
});
