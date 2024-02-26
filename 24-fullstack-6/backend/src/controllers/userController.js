import sequelize from "../utils/db.js";
import { dataValid } from "../validation/dataValidation.js";
import { sendMail, sendPassword } from "../utils/sendMail.js";
import User from "../models/userModel.js";
import { Op } from "sequelize";
import { compare } from "../utils/bcrypt.js";
import {
  generateAccessToken,
  generateRefreshToken,
  parseJWT,
  verifyRefreshToken,
} from "../utils/jwt.js";
import { isExists } from "../validation/sanitization.js";
import { Entropy, charset32 } from "entropy-string";
const setUser = async (req, res, next) => {
  const t = await sequelize.transaction();
  const valid = {
    name: "required",
    email: "required,isEmail",
    password: "required,isStrongPassword",
    confirmPassword: "required",
  };
  try {
    // const user = req.body;
    const user = await dataValid(valid, req.body);
    // cek password
    if (user.data.password !== user.data.confirmPassword) {
      user.message.push("Password does not match");
    }
    if (user.message.length > 0) {
      return res.status(400).json({
        errors: user.message,
        message: "Register Field",
        data: null,
      });
    }
    const userExists = await User.findAll({
      where: {
        email: user.data.email,
      },
    });
    if (userExists.length > 0 && userExists[0].isActive) {
      return res.status(400).json({
        errors: ["Email already activated"],
        message: "Register Field",
        data: null,
      });
    } else if (
      userExists.length > 0 &&
      !userExists[0].isActive &&
      Date.parse(userExists[0].expireTime) > new Date()
    ) {
      return res.status(400).json({
        errors: ["Email already registered, please check your email"],
        message: "Register Field",
        data: null,
      });
    } else {
      User.destroy(
        {
          where: {
            email: user.data.email,
          },
        },
        {
          transaction: t,
        }
      );
    }
    const newUser = await User.create(
      {
        ...user.data,
        expireTime: new Date(),
      },
      {
        transaction: t,
      }
    );
    const result = await sendMail(newUser.email, newUser.userId);
    if (!result) {
      await t.rollback();
      return res.status(500).json({
        errors: ["Send email failed"],
        message: "Register Field",
        data: null,
      });
    } else {
      await t.commit();
      res.status(201).json({
        errors: null,
        message: "User created, please check your email",
        data: {
          userId: newUser.userId,
          name: newUser.name,
          email: newUser.email,
          expireTime: newUser.expireTime.toString(),
        },
      });
    }
  } catch (error) {
    await t.rollback();
    next(new Error("controllers/userController.js:setUser - " + error.message));
  }
};

const setActivateUser = async (req, res, next) => {
  try {
    const user_id = req.params.id;
    const user = await User.findOne({
      where: {
        userId: user_id,
        isActive: false,
        expireTime: {
          [Op.gte]: new Date(),
        },
      },
    });
    if (!user) {
      return res.status(404).json({
        errors: ["User not found or expired"],
        message: "Activate User Field",
        data: null,
      });
    } else {
      user.isActive = true;
      user.expireTime = null;
      await user.save();
      return res.status(200).json({
        errors: [],
        message: "User activated successfully",
        data: {
          name: user.name,
          email: user.email,
        },
      });
    }
  } catch (error) {
    next(
      new Error(
        "controllers/userController.js:setActivateUser - " + error.message
      )
    );
  }
};

const getUser = async (req, res, next) => {
  try {
    const user = await User.findAll();
    res.status(200).json({
      errors: [],
      message: "User retrieved successfully",
      data: user,
    });
  } catch (error) {
    next(new Error("controllers/userController.js:getUser - " + error.message));
  }
};

const setLogin = async (req, res, next) => {
  try {
    const valid = {
      email: "required,isEmail",
      password: "required",
    };
    const user = await dataValid(valid, req.body);
    const data = user.data;
    if (user.message.length > 0) {
      return res.status(400).json({
        errors: user.message,
        message: "Login Field",
        data: null,
      });
    }
    const userExists = await User.findOne({
      where: {
        email: data.email,
        isActive: true,
      },
    });
    if (!userExists) {
      return res.status(400).json({
        errors: ["User not found"],
        message: "Login Field",
        data: data,
      });
    }
    if (compare(data.password, userExists.password)) {
      const usr = {
        userId: userExists.userId,
        name: userExists.name,
        email: userExists.email,
      };
      const token = generateAccessToken(usr);
      const refreshToken = generateRefreshToken(usr);
      return res.status(200).json({
        errors: [],
        message: "Login successfully",
        data: usr,
        acessToken: token,
        refreshToken: refreshToken,
      });
    } else {
      return res.status(400).json({
        errors: ["Wrong password"],
        message: "Login Field",
        data: data,
      });
    }
  } catch (error) {
    next(
      new Error("controllers/userController.js:setLogin - " + error.message)
    );
  }
};

const setRefreshToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({
        errors: ["Refresh token not found"],
        message: "Refresh Field",
        data: null,
      });
    }
    const verify = verifyRefreshToken(token);
    if (!verify) {
      return res.status(401).json({
        errors: ["Invalid refresh token"],
        message: "Refresh Field",
        data: null,
      });
    }
    let data = parseJWT(token);
    const user = await User.findOne({
      where: {
        email: data.email,
        isActive: true,
      },
    });
    if (!user) {
      return res.status(404).json({
        errors: ["User not found"],
        message: "Refresh Field",
        data: null,
      });
    } else {
      const usr = {
        userId: user.userId,
        name: user.name,
        email: user.email,
      };
      const token = generateAccessToken(usr);
      const refreshToken = generateRefreshToken(usr);
      return res.status(200).json({
        errors: [],
        message: "Refresh successfully",
        data: usr,
        acessToken: token,
        refreshToken: refreshToken,
      });
    }
  } catch (error) {
    next(
      new Error(
        "controllers/userController.js:setRefreshToken - " + error.message
      )
    );
  }
};

const updateUser = async (req, res, next) => {
  try {
    const user_id = req.params.id;
    const valid = {};
    if (isExists(req.body.name)) {
      valid.name = "required";
    }
    if (isExists(req.body.email)) {
      valid.email = "required,isEmail";
    }
    if (isExists(req.body.password)) {
      valid.password = "required,isStrongPassword";
      valid.conformPassword = "required";
    }
    const user = await dataValid(valid, req.body);
    if (
      isExists(user.data.password) &&
      user.data.password !== user.data.conformPassword
    ) {
      user.message.push("Password not match");
    }
    if (user.message.length > 0) {
      return res.status(400).json({
        errors: user.message,
        message: "Update Field",
        data: null,
      });
    }
    const result = await User.update(
      {
        ...user.data,
      },
      {
        where: {
          userId: user_id,
        },
      }
    );
    if (result[0] == 0) {
      return res.status(404).json({
        errors: ["User not found"],
        message: "Update Field",
        data: null,
      });
    } else {
      return res.status(200).json({
        errors: [],
        message: "User updated successfully",
        data: user.data,
      });
    }
  } catch (error) {
    next(
      new Error("controllers/userController.js:updateUser - " + error.message)
    );
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const user_id = req.params.id;
    const usrDelete = User.destroy({
      where: {
        userId: user_id,
      },
    });
    if (!usrDelete) {
      return res.status(404).json({
        errors: ["User not found"],
        message: "Delete Field",
        data: null,
      });
    }
    return res.status(200).json({
      errors: [],
      message: "User deleted successfully",
      data: null,
    });
  } catch (error) {
    next(
      new Error("controllers/userController.js:deleteUser - " + error.message)
    );
  }
};

const forgotPassword = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const valid = {
      email: "required,isEmail",
    };
    const userData = await dataValid(valid, req.body);
    if (userData.message.length > 0) {
      await t.rollback();
      return res.status(400).json({
        errors: userData.message,
        message: "Forgot Password Field",
        data: null,
      });
    }
    const user = await User.findOne({
      where: {
        email: userData.data.email,
      },
    });
    if (!user) {
      await t.rollback();
      return res.status(404).json({
        errors: ["User not found"],
        message: "Forgot Password Field",
        data: null,
      });
    }
    // dapatkan random password
    const random = new Entropy({ bits: 60, charset: charset32 });
    const stringPwd = random.string();
    await User.update(
      {
        password: stringPwd,
      },
      {
        where: {
          user_id: user.userId,
        },
        transaction: t,
      }
    );
    const result = await sendPassword(user.email, stringPwd);
    if (!result) {
      await t.rollback();
      return res.status(400).json({
        errors: ["Email not sent"],
        message: "Forgot Password Field",
        data: null,
      });
    }
    await t.commit();
    return res.status(200).json({
      errors: [],
      message: "Forgot Password success, please check your email",
      data: null,
    });
  } catch (error) {
    await t.rollback();
    next(
      new Error(
        "controllers/userController.js:forgotPassword - " + error.message
      )
    );
  }
};

export {
  setUser,
  setActivateUser,
  getUser,
  setLogin,
  setRefreshToken,
  updateUser,
  deleteUser,
  forgotPassword,
};
