Goal: Allow users to easily login and expose a live feed of their X posts that is always up-to-date while staying within the free plan of the X API which is strongly rate-limited. Users can choose to expose these tweets publicly (default) or under a secret link.

Specification:

- User logs in with x-oAuth, SQLite DO with name being the username is created and `GET /update` is called on it. Besides the SQL table for tweets, the durable object has regular kv storage state `{access_token:string,is_private:boolean,last_alarm_time:number}` where the access token comes from the oauth result, and is_private is false by default.
- The DO has a function `GET /update` that:
  - fetches recent tweets with all relevant metadata, and inserts/updates it into the SQLite storage.
  - if "updated_at" of /users/me endpoint on twitter is >24h ago it will fetch it again and store that in storage with new updated_at being `Date.now()`
  - If it found any NEW tweets (and inserted them) it sets a new alarm for after 15 minutes. If not, it doubles the alarm time with a maximum of 1 day from now (it stores `last_alarm_time` in storage)
  - For all new tweets inserted, it looks for tweet ids replied to that are not already in the DB, and uses `/2/tweets` to fetch these in a single additional api call to insert these into the db as well.
  - It also fetches recent retweets, likes, and bookmarks of tweets and these tweet contents in 3 distinct api calls, using the same principles.
- The worker exposes `GET /{username}` which returns all tweets based on recency for that username. If `is_private:true` it should be authenticated using `?secret=secret`. If a tweet is a reply, it shows the content of the reply, if available. It does so recursively. It first builds up this JSON dataset and then returns that or md or HTML. Default should be md if the extension isn't present.
