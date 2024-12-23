// script.js

let supabase; // We'll create it after fetching /config
let messagesSubscription;

/************************************************************
 * 1. HTML ELEMENTS
 ************************************************************/
const connectWalletBtn = document.getElementById("connectWalletBtn");
const messagesList = document.getElementById("messagesList");
const chatContainer = document.getElementById("chatContainer");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

/************************************************************
 * 2. HELPER FUNCTIONS
 ************************************************************/

// Random username generator
function generateRandomUsername() {
  const randomId = Math.floor(1000 + Math.random() * 9000);
  return "User" + randomId;
}

// Retrieve or create user in the "users" table
async function getOrCreateUser(publicKey) {
  // Check localStorage first
  let existingUser = JSON.parse(localStorage.getItem("myLivechatUser"));
  if (existingUser && existingUser.walletpublickey === publicKey) {
    return existingUser;
  }

  // Query Supabase
  const { data: userRecord, error } = await supabase
    .from("users")
    .select("*")
    .eq("walletpublickey", publicKey)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error fetching user:", error);
  }

  if (userRecord) {
    localStorage.setItem("myLivechatUser", JSON.stringify(userRecord));
    return userRecord;
  } else {
    // Create new user
    const newUsername = generateRandomUsername();
    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert([{ walletpublickey: publicKey, username: newUsername }])
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting user:", insertError);
      alert("Failed to create user in database.");
      return null;
    }
    localStorage.setItem("myLivechatUser", JSON.stringify(newUser));
    return newUser;
  }
}

// Add message to UI
function addMessageToUI(username, content) {
  const li = document.createElement("li");

  const userSpan = document.createElement("span");
  userSpan.textContent = username + ":";
  userSpan.classList.add("username");

  const contentSpan = document.createElement("span");
  contentSpan.textContent = " " + content;

  li.appendChild(userSpan);
  li.appendChild(contentSpan);
  messagesList.appendChild(li);

  // Auto-scroll
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Fetch existing messages
async function fetchExistingMessages() {
  const { data: messages, error } = await supabase
    .from("messages")
    .select("content, created_at, user_id, users(username)")
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Error fetching messages:", error);
    return;
  }
  messages.forEach((msg) => {
    addMessageToUI(msg.users.username, msg.content);
  });
}

// Subscribe to real-time inserts
function subscribeToMessages() {
  messagesSubscription = supabase
    .channel("public:messages")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
      const newMsg = payload.new;
      if (!newMsg) return;
      fetchUserAndRenderMessage(newMsg);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("Realtime subscription is active for messages.");
      }
    });
}

async function fetchUserAndRenderMessage(msgRow) {
  const { data: userData, error } = await supabase
    .from("users")
    .select("username")
    .eq("id", msgRow.user_id)
    .single();

  if (error) {
    console.error("Error fetching user for message:", error);
    return;
  }
  addMessageToUI(userData.username, msgRow.content);
}

/************************************************************
 * 3. EVENT HANDLERS
 ************************************************************/

connectWalletBtn.addEventListener("click", async () => {
  if (window.solana && window.solana.isPhantom) {
    try {
      const response = await window.solana.connect({ onlyIfTrusted: false });
      const publicKey = response.publicKey.toString();
      console.log("Connected with PublicKey:", publicKey);

      // Get or create user
      const user = await getOrCreateUser(publicKey);
      if (user) {
        alert(`Wallet connected! You are ${user.username}`);
      }
    } catch (err) {
      console.error("Phantom connection error:", err);
      alert("Could not connect Phantom wallet.");
    }
  } else {
    alert("Phantom wallet extension not found!");
  }
});

// Send message
sendBtn.addEventListener("click", sendMessage);
chatInput.addEventListener("keyup", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});

async function sendMessage() {
  const userData = JSON.parse(localStorage.getItem("myLivechatUser"));
  if (!userData || !userData.id) {
    alert("You must connect your Phantom wallet first!");
    return;
  }

  const content = chatInput.value.trim();
  if (!content) return;

  const { error } = await supabase
    .from("messages")
    .insert([{ user_id: userData.id, content }]);

  if (error) {
    console.error("Error sending message:", error);
    alert("Failed to send message!");
    return;
  }
  chatInput.value = "";
}

/************************************************************
 * 4. INIT
 ************************************************************/

window.addEventListener("DOMContentLoaded", async () => {
  // 1. Fetch /config to get .env data
  try {
    const configResponse = await fetch("/config");
    const configData = await configResponse.json();

    // 2. Create supabase client
    supabase = window.supabase.createClient(
      configData.SUPABASE_URL,
      configData.SUPABASE_ANON_KEY
    );

    // 3. Load existing messages, subscribe to new ones
    await fetchExistingMessages();
    subscribeToMessages();
  } catch (err) {
    console.error("Failed to load environment config:", err);
    alert("Could not load environment configuration from server.");
  }
});
