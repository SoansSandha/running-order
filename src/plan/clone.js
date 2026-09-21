/**
 * Clone-and-sort: create a new playlist holding the sorted order.
 *
 * See docs design §9.2. This path skips the move algorithm entirely — a new
 * playlist is filled by bulk-adding URIs, roughly one request per hundred
 * tracks, so it takes seconds where an in-place reorder takes minutes.
 *
 * The trade is that a clone can legitimately be SHORTER than its source:
 * local files and unavailable tracks have no URI that can be added to another
 * playlist. The report says so, and the preview shows it before anything is
 * created.
 */

export async function executeClone({
  writer,
  userId,
  sourcePlaylist,
  targetTracks,
  strategyLabel,
  isPublic = false,
  onProgress,
  dryRun = false,
}) {
  const cloneable = []
  const skipped = { localFiles: 0, unavailable: 0, names: [] }

  for (const track of targetTracks) {
    if (track.isUnavailable || !track.uri) {
      skipped.unavailable += 1
      skipped.names.push(track.name || 'Unavailable track')
    } else if (track.isLocal) {
      skipped.localFiles += 1
      skipped.names.push(track.name)
    } else {
      cloneable.push(track)
    }
  }

  if (dryRun) {
    return {
      playlist: null,
      requested: targetTracks.length,
      added: 0,
      wouldAdd: cloneable.length,
      skipped,
    }
  }

  const playlist = await writer.createPlaylist(userId, {
    name: `${sourcePlaylist.name} (sorted by ${strategyLabel})`,
    description: `Sorted copy of "${sourcePlaylist.name}" by ${strategyLabel}, ${formatToday()}.`,
    isPublic,
  })

  await writer.addTracks(playlist.id, cloneable, { onProgress })

  return {
    playlist,
    requested: targetTracks.length,
    added: cloneable.length,
    wouldAdd: cloneable.length,
    skipped,
  }
}

function formatToday() {
  return new Date().toISOString().slice(0, 10)
}
