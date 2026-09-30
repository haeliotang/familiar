import type { Cue } from '../src/encounter'

export const phrasePacks: Record<string, { version: string; hashes: Record<Cue, string[]> }> = {
  "kokoro-zh-zm009-v1": {
    "version": "original-boundary-phrases-v1",
    "hashes": {
      "general": [
        "2236a05969a20450abbf35f21d7e6fac8b8eddb137776fcfc4b02c6e9c5f1ea4"
      ],
      "wait": [
        "560a62bf30cf76deb511866f99dee34d2d64512e1fba007fed5f87070d8da2ae",
        "7b843c55a45bd41d93de22476989caa9aaacbf480b3982b666ab86d309d1ddf9"
      ],
      "repair": [
        "8a57a61c344ba680b596d7d2e135307cee54b48fccb30f90e9c5739843dc4d1f",
        "bc739b1f77d30a28e0f2376fc90e0221b497f3a7d37684ce8e4c8bb80a5a4ea4"
      ]
    }
  },
  "kokoro-zh-zf001-v1": {
    "version": "original-boundary-phrases-v1",
    "hashes": {
      "general": [
        "3d4319dd467854edcf334eb3432e0b15ed1da1d593adc26efad18e0950bcd1e1"
      ],
      "wait": [
        "56004559f515744aaac3056547f0a153fc99869f626d392cdbf8e56c088808cc",
        "82c9b3d7fcc9f6b4f725e237d0149ccf6822fb85cd3059da4212985f6e9f3bba"
      ],
      "repair": [
        "8fe40e1df5afbe1e77b385260c38c3a1af92bab31998c41395ac23129fe5b8c8",
        "0664469f69a317d9f3c181fcbbe3b616f0d43120500e3d6689a60c0e4f2815cd"
      ]
    }
  }
}
