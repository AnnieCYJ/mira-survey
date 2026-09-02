import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import Card from './Card';

export interface ListItem {
  dot: string;
  title: string;
  sub: string;
  right?: string;
}

interface Props {
  title: string;
  items: ListItem[];
}

export default function ListCard({ title, items }: Props) {
  return (
    <Card>
      <Text style={styles.title}>{title}</Text>
      {items.map((it, i) => (
        <View key={i} style={[styles.row, i === items.length - 1 && styles.last]}>
          <View style={[styles.dot, { backgroundColor: it.dot }]} />
          <View style={styles.body}>
            <Text style={styles.itemTitle}>{it.title}</Text>
            <Text style={styles.itemSub}>{it.sub}</Text>
          </View>
          {it.right ? <Text style={styles.right}>{it.right}</Text> : null}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
    marginBottom: theme.space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(120,120,180,0.08)',
  },
  last: { borderBottomWidth: 0, paddingBottom: 0 },
  dot: {
    width: theme.sp(2),
    height: theme.sp(2),
    borderRadius: theme.radius.pill,
    marginRight: theme.space.sm,
  },
  body: { flex: 1 },
  itemTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textBody,
    marginBottom: theme.sp(1),
  },
  itemSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  right: { fontSize: theme.fontSize.micro, color: theme.colors.accentSolid },
});
