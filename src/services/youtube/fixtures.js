/**
 * Field sets measured from a real YouTube Music playlist on 2026-09-22.
 * Titles, ids and artist names are substituted; the SHAPES are exact —
 * including that `feedbackTokens` appears only on album tracks, and that
 * `album` is null rather than absent on videos and user uploads.
 */

export const ALBUM_TRACK = {
  album: { id: 'MPREb_album1', name: 'An Album' },
  artists: [{ id: 'UCartist1', name: 'An Artist' }],
  communityVoteStatus: null,
  duration: '3:31',
  duration_seconds: 211,
  feedbackTokens: { add: 'tok-add', remove: 'tok-remove' },
  inLibrary: false,
  isAvailable: true,
  isExplicit: false,
  likeStatus: 'INDIFFERENT',
  listenAgainFeedbackTokens: { pin: 'tok-pin', unpin: 'tok-unpin' },
  pinnedToListenAgain: false,
  setVideoId: 'SV0001',
  thumbnails: [{ url: 'https://example.invalid/a.jpg', width: 60, height: 60 }],
  title: 'Album Track',
  videoId: 'VID0001',
  videoType: 'MUSIC_VIDEO_TYPE_ATV',
  views: null,
}

export const MUSIC_VIDEO = {
  album: null,
  artists: [{ id: 'UCartist2', name: 'Another Artist' }],
  communityVoteStatus: null,
  duration: '4:02',
  duration_seconds: 242,
  inLibrary: false,
  isAvailable: true,
  isExplicit: false,
  likeStatus: 'INDIFFERENT',
  listenAgainFeedbackTokens: { pin: 'tok-pin', unpin: 'tok-unpin' },
  pinnedToListenAgain: false,
  setVideoId: 'SV0002',
  thumbnails: [{ url: 'https://example.invalid/b.jpg', width: 60, height: 60 }],
  title: 'A Music Video',
  videoId: 'VID0002',
  videoType: 'MUSIC_VIDEO_TYPE_OMV',
  views: null,
}

export const USER_UPLOAD = {
  ...MUSIC_VIDEO,
  artists: [{ id: null, name: 'Some Uploader' }],
  setVideoId: 'SV0003',
  title: 'A User Upload',
  videoId: 'VID0003',
  videoType: 'MUSIC_VIDEO_TYPE_UGC',
}

export const UNAVAILABLE = {
  ...MUSIC_VIDEO,
  isAvailable: false,
  setVideoId: 'SV0004',
  title: 'Gone',
  videoId: 'VID0004',
}

export const UNTYPED = {
  ...MUSIC_VIDEO,
  setVideoId: 'SV0005',
  title: 'Untyped',
  videoId: 'VID0005',
  videoType: null,
}
