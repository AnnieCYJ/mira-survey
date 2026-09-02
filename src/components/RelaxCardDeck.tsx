import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { theme } from '../theme/theme';
import Card from './Card';
import Icon from './Icon';

const relaxImage = require('../assets/card_relax.jpg');

interface Props {
  onPlayRelax: () => void;
}

export default function RelaxCardDeck({ onPlayRelax }: Props) {
  return (
    <View style={styles.deck}>
      <Text style={styles.deckTitle}>集成就卡</Text>
      <View style={styles.cards}>
        <TouchableOpacity activeOpacity={0.85} onPress={onPlayRelax}>
          <Card style={styles.card} padded={false}>
            <Image source={relaxImage} style={styles.image} resizeMode="cover" />
            <View style={styles.labelWrap}>
              <Text style={styles.label}>悠然自得</Text>
            </View>
            <View style={styles.playBadge} pointerEvents="none">
              <Icon name="play" size={theme.fs(14)} color={theme.colors.textWhite} />
            </View>
          </Card>
        </TouchableOpacity>
        <View style={styles.emptyCard} />
        <View style={styles.emptyCard} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  deck: { marginTop: theme.space.card },
  deckTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
    marginBottom: theme.space.sm,
  },
  cards: {
    flexDirection: 'row',
    gap: theme.space.sm,
  },
  card: {
    width: 116,
    height: 148,
    overflow: 'hidden',
    backgroundColor: theme.colors.cardBgStrong,
  },
  image: {
    width: '100%',
    height: 116,
  },
  playBadge: {
    position: 'absolute',
    right: theme.sp(2),
    bottom: theme.sp(2),
    width: theme.sp(7),
    height: theme.sp(7),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.ui.scrimDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space.sm,
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  emptyCard: {
    width: 116,
    height: 148,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.ui.playBadge,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
});
