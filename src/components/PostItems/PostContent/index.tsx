import {
  EventId,
  EventSetMetadataContent,
  EventTags,
} from 'core/nostr/type';
import { Event } from 'core/nostr/Event';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef, useState } from 'react';
import { useReadonlyMyPublicKey } from 'hooks/useMyPublicKey';
import { useLoadSelectedRelays } from 'components/RelaySelector/hooks/useLoadSelectedRelays';
import { Relay } from 'core/relay/type';
import {
  EmbedRef,
  extractEmbedRef,
  getPubkeysFromEmbedRef,
} from './Embed/util';
import { transformRefEmbed } from './Embed';
import { MediaPreviews } from './Media';
import styles from './index.module.scss';
import { Avatar, Button } from 'antd';
import {
  normalizeContent,
  shortifyEventId,
  shortifyPublicKey,
} from 'core/nostr/content';
import { CallWorker } from 'core/worker/caller';
import { Nip23 } from 'core/nip/23';
import PostArticle from '../PostArticle';
import Link from 'next/link';
import { Paths } from 'constants/path';
import { maxStrings } from 'utils/common';
import { useRouter } from 'next/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { dbQuery, dexieDb } from 'core/db';
import { DbEvent } from 'core/db/schema';
import { isNsfwEvent } from 'utils/validator';

interface PostContentProp {
  ownerEvent: Event;
  worker: CallWorker;
  showLastReplyToEvent?: boolean;
}

export const PostContent: React.FC<PostContentProp> = ({
  ownerEvent: msgEvent,
  worker,
  showLastReplyToEvent = true,
}) => {
  const { t } = useTranslation();
  const myPublicKey = useReadonlyMyPublicKey();
  const [relayUrls, setRelayUrls] = useState<string[]>([]);
  const [embedRef, setEmbedRef] = useState<EmbedRef>();
  const [contentComponents, setContentComponents] = useState<any[]>([]);
  const [lastReplyToEventId, setLastReplyToEventId] = useState<EventId>();
  const [profileEvents, setProfileEvents] = useState<DbEvent[]>([]);

  useLoadSelectedRelays(myPublicKey, (r: Relay[]) => {
    setRelayUrls(r.map(r => r.url));
  });

  useEffect(() => {
    extractFromContent();
  }, [msgEvent.content, relayUrls]);

  useEffect(() => {
    if (!embedRef) return;

    const pks = getPubkeysFromEmbedRef(embedRef);

    dexieDb.profileEvent.bulkGet(pks).then(events => {
      const data = events.filter(e => e != null) as DbEvent[];
      setProfileEvents(data);
    });
    transformContent();
  }, [embedRef]);

  useEffect(() => {
    if (showLastReplyToEvent) {
      buildLastReplyEvent();
    }
  }, [msgEvent.content]);

  const lastReplyEventFromDb = useLiveQuery(
    dbQuery.createEventByIdQuerier(relayUrls, lastReplyToEventId),
    [relayUrls, lastReplyToEventId],
  );

  const transformContent = async () => {
    if (!embedRef) return;
    const { modifiedText } = normalizeContent(msgEvent.content);
    const result = transformRefEmbed(modifiedText, embedRef, profileEvents);
    setContentComponents(result);
  };

  const extractFromContent = async () => {
    const { modifiedText } = normalizeContent(msgEvent.content);
    const ref = await extractEmbedRef(modifiedText, relayUrls);
    setEmbedRef(ref);
  };

  const buildLastReplyEvent = async () => {
    const lastReply = msgEvent.tags
      .filter(t => t[0] === EventTags.E)
      .map(t => {
        return { id: t[1], relay: t[2]?.split(',')[0] };
      })
      .pop();

    if (lastReply) {
      setLastReplyToEventId(lastReply.id);

      if (lastReplyEventFromDb) {
        return;
      }

      // fallback
      // if (lastReply.relay && lastReply.relay !== '') {
      //   const replyToEvent = await OneTimeWebSocketClient.fetchEvent({
      //     eventId: lastReply.id,
      //     relays: [lastReply.relay],
      //   });
      //   if (replyToEvent) {
      //     //setLastReplyToEvent(replyToEvent);
      //   }
      // }
    }
  };

  const tryReloadLastReplyEvent = () => {
    if (!lastReplyToEventId) return;

    worker.subMsgByEventIds([lastReplyToEventId]);
  };

  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const isOverflow =
    contentRef.current &&
    contentRef.current.scrollHeight > contentRef.current.clientHeight;

  const toggleExpanded = () => {
    setExpanded(!expanded);
  };

  const content = (
    <div>
      <div>{contentComponents}</div>
    </div>
  );

  return (
    <div>
      {expanded ? (
        content
      ) : (
        <div>
          <div
            ref={contentRef}
            style={{ maxHeight: '100px', overflow: 'hidden' }}
          >
            {content}
          </div>
          {isOverflow && (
            <Button
              className={styles.viewMore}
              type="link"
              onClick={toggleExpanded}
            >
              {' '}
              View More
            </Button>
          )}
        </div>
      )}
      <>
        {showLastReplyToEvent && lastReplyEventFromDb && (
          <SubPostItem event={lastReplyEventFromDb} />
        )}
        {showLastReplyToEvent && !lastReplyEventFromDb && lastReplyToEventId && (
          <div className={styles.replyEvent}>
            <Link href={`${Paths.event + '/' + lastReplyToEventId}`}>
              event@{shortifyEventId(lastReplyToEventId)}
            </Link>
            <Button onClick={tryReloadLastReplyEvent} type="link">
              try reload
            </Button>
          </div>
        )}
        <MediaPreviews isNsfw={isNsfwEvent(msgEvent)} content={msgEvent.content} />
      </>
    </div>
  );
};

export interface SubPostItemProp {
  event: Event;
}

export const SubPostItem: React.FC<SubPostItemProp> = ({ event }) => {
  const router = useRouter();
  const clickUserProfile = () => {
    router.push(`/user/${event.pubkey}`);
  };
  const clickEventBody = () => {
    router.push(`/event/${event.id}`);
  };

  const [loadedUserProfile, setLoadedUserProfile] =
    useState<EventSetMetadataContent>();
  const loadUserProfile = async () => {
    // todo: set relay urls with correct one
    const profileEvent = await dexieDb.profileEvent.get(event.pubkey);
    if (profileEvent) {
      const metadata = JSON.parse(
        profileEvent.content,
      ) as EventSetMetadataContent;
      setLoadedUserProfile(metadata);
    }
  };
  useEffect(() => {
    loadUserProfile();
  }, [event]);

  return Nip23.isBlogPost(event) ? (
    <PostArticle
      userAvatar={loadedUserProfile?.picture || ''}
      userName={loadedUserProfile?.name || ''}
      event={event}
      key={event.id}
    />
  ) : (
    <div className={styles.replyEvent}>
      <div className={styles.user} onClick={clickUserProfile}>
        <Avatar src={loadedUserProfile?.picture} alt="picture" />
        <span className={styles.name}>
          {loadedUserProfile?.name || shortifyPublicKey(event.pubkey)}
        </span>
      </div>
      <div className={styles.content}>
        <div className={styles.event} onClick={clickEventBody}>
          {maxStrings(event.content, 150)}
        </div>
        <MediaPreviews content={event.content} />
      </div>
    </div>
  );
};
